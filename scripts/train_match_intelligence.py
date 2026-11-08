#!/usr/bin/env python3
"""Leakage-aware model comparison and diagnostics for LIVE Match Intelligence."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

INPUT = Path("audit-output/match-intelligence-dataset.json")
OUT = Path("audit-output")
BASE = ["minute", "home_score", "away_score", "score_difference"]
EXTENDED = BASE + [
    "sot_home", "sot_away", "sot_diff",
    "shots_off_home", "shots_off_away", "shots_off_diff",
    "sot_delta_home", "sot_delta_away",
    "shots_off_delta_home", "shots_off_delta_away",
    "possession_home", "possession_away", "possession_diff",
]
TARGETS = {
    "any_goal_remaining": ("label_any_goal_remaining", BASE),
    "home_goal_remaining": ("label_home_goal_remaining", EXTENDED),
    "away_goal_remaining": ("label_away_goal_remaining", EXTENDED),
}
BOOTSTRAPS = 250
SEED = 20261108


def match_weights(frame):
    counts = frame.groupby("match_id")["match_id"].transform("count").astype(float)
    return 1.0 / counts


def fit_model(train, target, features):
    model = Pipeline([
        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("model", LogisticRegression(max_iter=2500, C=0.5)),
    ])
    model.fit(train[features], train[target].astype(int),
              model__sample_weight=match_weights(train))
    return model


def export_model(model, features):
    imputer, scaler, logistic = (model.named_steps[k] for k in ("impute", "scale", "model"))
    indicators = imputer.indicator_.features_.astype(int).tolist() if imputer.add_indicator and imputer.indicator_ is not None else []
    return {
        "features": features,
        "imputer_medians": [float(x) for x in imputer.statistics_],
        "missing_indicator_feature_indices": indicators,
        "scaler_mean": [float(x) for x in scaler.mean_],
        "scaler_scale": [float(x) for x in scaler.scale_],
        "coefficients": [float(x) for x in logistic.coef_[0]],
        "intercept": float(logistic.intercept_[0]),
        "inference": "Impute null features with medians; append missing flags in listed feature-index order; standardise; sigmoid(intercept + dot(coefficients, vector)).",
    }


def grouped_auc_interval(frame, target, probabilities, rng):
    groups = frame["match_id"].drop_duplicates().to_numpy()
    by_group = {g: np.flatnonzero(frame["match_id"].to_numpy() == g) for g in groups}
    y = frame[target].astype(int).to_numpy()
    values = []
    for _ in range(BOOTSTRAPS):
        sampled = rng.choice(groups, size=len(groups), replace=True)
        ys, ps, ws = [], [], []
        for group in sampled:
            idx = by_group[group]
            ys.append(y[idx]); ps.append(probabilities[idx]); ws.append(np.full(len(idx), 1.0 / len(idx)))
        yy, pp, ww = np.concatenate(ys), np.concatenate(ps), np.concatenate(ws)
        if np.unique(yy).size == 2:
            values.append(float(roc_auc_score(yy, pp, sample_weight=ww)))
    return [float(x) for x in np.quantile(values, [0.025, 0.5, 0.975])] if values else None


def evaluate(frame, target, probabilities):
    weights = match_weights(frame).to_numpy()
    y = frame[target].astype(int).to_numpy()
    return {
        "rows": int(len(frame)), "matches": int(frame.match_id.nunique()),
        "positive_rate_match_weighted": float(np.average(y, weights=weights)),
        "mean_prediction_match_weighted": float(np.average(probabilities, weights=weights)),
        "auc": float(roc_auc_score(y, probabilities, sample_weight=weights)) if np.unique(y).size == 2 else None,
        "brier": float(brier_score_loss(y, probabilities, sample_weight=weights)),
        "log_loss": float(log_loss(y, probabilities, sample_weight=weights, labels=[0, 1])),
        "accuracy_at_0_50": float(accuracy_score(y, probabilities >= 0.5, sample_weight=weights)),
    }


def calibration_bins(frame, target, probabilities):
    weights, y = match_weights(frame).to_numpy(), frame[target].astype(int).to_numpy()
    result = []
    edges = np.linspace(0, 1, 11)
    for i in range(10):
        mask = (probabilities >= edges[i]) & (probabilities < edges[i+1] if i < 9 else probabilities <= 1)
        if mask.any():
            result.append({
                "lower": round(float(edges[i]), 1), "upper": round(float(edges[i+1]), 1),
                "rows": int(mask.sum()),
                "mean_prediction": round(float(np.average(probabilities[mask], weights=weights[mask])), 3),
                "observed_rate": round(float(np.average(y[mask], weights=weights[mask])), 3),
            })
    return result


def add_strata(frame):
    out = frame.copy()
    out["minute_bucket"] = pd.cut(
        out.minute, bins=[0, 30, 60, 75, 90],
        labels=["01-30", "31-60", "61-75", "76-90"], include_lowest=True
    ).astype("string")
    out["score_state"] = np.select(
        [out.home_score == out.away_score, out.home_score > out.away_score],
        ["draw", "home_leading"], default="away_leading"
    )
    return out


def subgroup_report(frame, target, probabilities):
    work = add_strata(frame)
    work["_p"] = probabilities
    result = {}
    for field in ("minute_bucket", "score_state"):
        result[field] = {}
        for label, group in work.groupby(field, observed=True):
            if len(group) < 30 or group.match_id.nunique() < 10:
                continue
            result[field][str(label)] = evaluate(group, target, group["_p"].to_numpy())
    return result


def main():
    if not INPUT.exists():
        raise SystemExit(f"Dataset not found: {INPUT}")
    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    frame = pd.DataFrame(payload.get("rows", []))
    if frame.empty or "dataset_split" not in frame:
        raise SystemExit("Dataset is empty or missing dataset_split.")
    train = frame[frame.dataset_split == "train"].copy()
    test = frame[frame.dataset_split == "test"].copy()
    if train.match_id.nunique() < 100 or test.match_id.nunique() < 50:
        raise SystemExit("Insufficient independent matches for out-of-sample evaluation.")

    rng = np.random.default_rng(SEED)
    output = {
        "model_status": "EXPERIMENTAL_OUT_OF_SAMPLE_NOT_FOR_BETTING",
        "generated_at_utc": pd.Timestamp.now(tz="UTC").isoformat(),
        "sklearn_version": sklearn.__version__,
        "dataset": {
            "rows": int(len(frame)), "matches": int(frame.match_id.nunique()),
            "train_rows": int(len(train)), "train_matches": int(train.match_id.nunique()),
            "test_rows": int(len(test)), "test_matches": int(test.match_id.nunique()),
            "split": "Chronological match-level split; every snapshot from a match remains in one partition."
        },
        "weighting": "Every match contributes equal total weight in fitting and metrics.",
        "models": {}, "comparisons": {}, "calibration_bins": {}, "subgroups": {},
        "limitations": [
            "No bookmaker odds, market prices, or execution outcomes; no value or ROI conclusion is possible.",
            "Repeated snapshots are clustered by match for splitting, weighting, and bootstrap uncertainty.",
            "Subgroup metrics are diagnostic and can be noisy; groups under 30 snapshots or 10 matches are omitted.",
            "No probability calibration layer is fitted yet; calibration bins are diagnostics only.",
            "No dangerous-attacks feature is used; this model is not connected to production signals."
        ]
    }

    for name, (target, features) in TARGETS.items():
        baseline = fit_model(train, target, BASE)
        base_p = baseline.predict_proba(test[BASE])[:, 1]
        selected_features = features
        model = fit_model(train, target, selected_features)
        pred = model.predict_proba(test[selected_features])[:, 1]
        metrics = evaluate(test, target, pred)
        metrics["auc_95pct_group_bootstrap"] = grouped_auc_interval(test, target, pred, rng)
        baseline_metrics = evaluate(test, target, base_p)
        output["models"][name] = {
            "target": target, "features": selected_features, "metrics": metrics,
            "parameters": export_model(model, selected_features)
        }
        output["comparisons"][name] = {
            "baseline_features": BASE,
            "baseline_metrics": baseline_metrics,
            "selected_model_metrics": {k: metrics[k] for k in ("auc", "brier", "log_loss", "accuracy_at_0_50")},
            "delta_selected_minus_baseline": {
                k: (metrics[k] - baseline_metrics[k]) if metrics[k] is not None and baseline_metrics[k] is not None else None
                for k in ("auc", "brier", "log_loss", "accuracy_at_0_50")
            },
            "interpretation": "Positive AUC delta and negative Brier/log-loss deltas favour the selected model."
        }
        output["calibration_bins"][name] = calibration_bins(test, target, pred)
        output["subgroups"][name] = subgroup_report(test, target, pred)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "match-intelligence-models.json").write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = [
        "# LIVE Match Intelligence – model comparison and diagnostics", "",
        f"Generated UTC: {output['generated_at_utc']}",
        f"Dataset: {len(frame):,} snapshots from {frame.match_id.nunique():,} matches.",
        f"Train/test: {len(train):,} / {len(test):,} snapshots; {train.match_id.nunique():,} / {test.match_id.nunique():,} matches.",
        "", "Every match has equal total weight. All snapshots from one match remain in one partition.",
        "", "## Out-of-sample model metrics",
        "", "| Target | Model | AUC | Brier | Log loss | Observed | Predicted |",
        "|---|---|---:|---:|---:|---:|---:|"
    ]
    for name, item in output["models"].items():
        target = item["target"]
        for label, m in (("Minute + score baseline", output["comparisons"][name]["baseline_metrics"]),
                         ("Selected model", item["metrics"])):
            lines.append(f"| {name} | {label} | {m['auc']:.3f} | {m['brier']:.3f} | {m['log_loss']:.3f} | {m['positive_rate_match_weighted']:.3f} | {m['mean_prediction_match_weighted']:.3f} |")
    lines += ["", "## Added feature value (selected model minus baseline)", "",
              "| Target | Δ AUC | Δ Brier | Δ Log loss |", "|---|---:|---:|---:|"]
    for name, c in output["comparisons"].items():
        d = c["delta_selected_minus_baseline"]
        lines.append(f"| {name} | {d['auc']:+.3f} | {d['brier']:+.3f} | {d['log_loss']:+.3f} |")
    for name, bins in output["calibration_bins"].items():
        lines += ["", f"## Calibration – {name}", "",
                  "| Predicted bin | Snapshots | Mean prediction | Observed rate |",
                  "|---|---:|---:|---:|"]
        for r in bins:
            lines.append(f"| {r['lower']:.1f}–{r['upper']:.1f} | {r['rows']} | {r['mean_prediction']:.3f} | {r['observed_rate']:.3f} |")
    for name, strata in output["subgroups"].items():
        lines += ["", f"## Situation diagnostics – {name}", ""]
        for field, groups in strata.items():
            lines += [f"### {field}", "", "| Group | Snapshots | Matches | AUC | Brier | Log loss |",
                      "|---|---:|---:|---:|---:|---:|"]
            for label, m in groups.items():
                auc = f"{m['auc']:.3f}" if m["auc"] is not None else "—"
                lines.append(f"| {label} | {m['rows']} | {m['matches']} | {auc} | {m['brier']:.3f} | {m['log_loss']:.3f} |")
    lines += ["", "## Interpretation limits", "",
              "- AUC measures ranking/discrimination, not hit rate or profitability.",
              "- Added feature value is judged against a same-target minute+score baseline on the same held-out matches.",
              "- Subgroup results are descriptive and should not be used to select betting thresholds without a fresh holdout.",
              "- No bookmaker odds, margin, availability, or staking outcomes are present.",
              "- Do not publish alerts or use these outputs as betting recommendations; this remains an isolated experiment.", ""]
    (OUT / "match-intelligence-training-report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "status": output["model_status"], "dataset": output["dataset"],
        "comparisons": output["comparisons"], "subgroups": output["subgroups"]
    }, indent=2))


if __name__ == "__main__":
    main()
