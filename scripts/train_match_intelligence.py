#!/usr/bin/env python3
"""Leakage-aware model comparison and diagnostics for LIVE Match Intelligence."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.model_selection import GroupKFold
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
    "any_goal_remaining": ("label_any_goal_remaining", EXTENDED),
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



def logit(p):
    clipped = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped)).reshape(-1, 1)


def fit_oof_platt_calibrator(train, target, features):
    groups = train["match_id"].to_numpy()
    oof = np.full(len(train), np.nan, dtype=float)
    splitter = GroupKFold(n_splits=5)
    for fit_idx, calibration_idx in splitter.split(train, train[target], groups):
        fold_train = train.iloc[fit_idx]
        fold_valid = train.iloc[calibration_idx]
        fold_model = fit_model(fold_train, target, features)
        oof[calibration_idx] = fold_model.predict_proba(fold_valid[features])[:, 1]
    if not np.isfinite(oof).all():
        raise RuntimeError("OOF calibration predictions are incomplete.")
    calibrator = LogisticRegression(C=1e6, max_iter=2000)
    calibrator.fit(logit(oof), train[target].astype(int),
                   sample_weight=match_weights(train))
    return calibrator, oof


def apply_platt(calibrator, probabilities):
    return calibrator.predict_proba(logit(probabilities))[:, 1]


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



def prepare_count_features(frame):
    out = frame.copy()
    elapsed = out["minute"].clip(lower=1).astype(float)
    for key in ("sot_home", "sot_away", "shots_off_home", "shots_off_away", "shots_home", "shots_away"):
        if key in out:
            out[key + "_per_minute"] = out[key] / elapsed
    gap_minutes = out["interval_seconds"].clip(lower=20) / 60.0
    for key in ("sot_delta_home", "sot_delta_away", "shots_off_delta_home", "shots_off_delta_away", "shots_delta_home", "shots_delta_away"):
        if key in out:
            out[key + "_per_minute"] = out[key] / gap_minutes
    out["remaining_minutes"] = (90 - out["minute"]).clip(lower=0)
    return out


def fit_poisson_count(train, target, features):
    model = Pipeline([
        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", HistGradientBoostingRegressor(
            loss="poisson", max_iter=180, learning_rate=0.05,
            max_leaf_nodes=15, min_samples_leaf=50,
            l2_regularization=3.0, early_stopping=False,
            random_state=SEED
        )),
    ])
    model.fit(train[features], train[target].astype(float),
              model__sample_weight=match_weights(train))
    return model


def count_metrics(frame, target, prediction):
    weights = match_weights(frame).to_numpy()
    actual = frame[target].astype(float).to_numpy()
    pred = np.clip(np.asarray(prediction, dtype=float), 0, None)
    binary_target = {
        "goals_remaining": "label_any_goal_remaining",
        "home_goals_remaining": "label_home_goal_remaining",
        "away_goals_remaining": "label_away_goal_remaining"
    }[target]
    return {
        "rows": int(len(frame)), "matches": int(frame.match_id.nunique()),
        "observed_mean": float(np.average(actual, weights=weights)),
        "predicted_mean": float(np.average(pred, weights=weights)),
        "mae": float(mean_absolute_error(actual, pred, sample_weight=weights)),
        "rmse": float(np.sqrt(mean_squared_error(actual, pred, sample_weight=weights))),
        "derived_any_probability_metrics": evaluate(frame, binary_target, -np.expm1(-pred))
    }


def main():
    if not INPUT.exists():
        raise SystemExit(f"Dataset not found: {INPUT}")
    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    frame = pd.DataFrame(payload.get("rows", []))
    if frame.empty or "dataset_split" not in frame:
        raise SystemExit("Dataset is empty or missing dataset_split.")
    train = frame[frame.dataset_split == "train"].copy()
    test = frame[frame.dataset_split == "test"].copy()
    if train.match_id.nunique() < 100:
        raise SystemExit("Insufficient independent pre-cutoff training matches.")
    holdout_min = int(payload.get("report", {}).get("dataset", {}).get("min_test_matches_for_metrics", 50))
    has_forward_test = test.match_id.nunique() >= holdout_min
    rng = np.random.default_rng(SEED)
    output = {
        "model_status": "EXPERIMENTAL_FORWARD_VALIDATION" if has_forward_test else "FROZEN_CANDIDATE_AWAITING_FORWARD_HOLDOUT",
        "generated_at_utc": pd.Timestamp.now(tz="UTC").isoformat(),
        "sklearn_version": sklearn.__version__,
        "dataset": {
            "rows": int(len(frame)), "matches": int(frame.match_id.nunique()),
            "train_rows": int(len(train)), "train_matches": int(train.match_id.nunique()),
            "test_rows": int(len(test)), "test_matches": int(test.match_id.nunique()),
            "holdout_after_utc": payload.get("report", {}).get("dataset", {}).get("holdout_after_utc"),
            "forward_test_ready": bool(has_forward_test),
            "split": payload.get("report", {}).get("dataset", {}).get("split", "Frozen forward-only match-level split.")
        },
        "weighting": "Every match contributes equal total weight in fitting and metrics.",
        "models": {}, "comparisons": {}, "calibration_bins": {}, "subgroups": {}, "poisson_count_models": {},
        "limitations": [
            "The frozen cutoff is never moved after inspecting forward-test results.",
            "No bookmaker odds, market prices, or execution outcomes; no value or ROI conclusion is possible.",
            "Repeated snapshots are clustered by match for splitting, weighting, and bootstrap uncertainty.",
            "Probability calibration uses out-of-fold predictions grouped by match; the forward test is never used to fit calibration.",
            "No dangerous-attacks feature is used; this model is not connected to production signals."
        ]
    }

    for name, (target, features) in TARGETS.items():
        selected_features = features
        model = fit_model(train, target, selected_features)
        calibrator, oof_predictions = fit_oof_platt_calibrator(train, target, selected_features)
        calibration_info = {
            "method": "Platt scaling fitted on 5-fold out-of-fold predictions; folds grouped by match.",
            "training_oof_rows": int(len(oof_predictions)),
            "training_oof_matches": int(train.match_id.nunique()),
            "slope": float(calibrator.coef_[0][0]),
            "intercept": float(calibrator.intercept_[0]),
            "inference": "Compute raw model probability p; calibrated p = sigmoid(slope * logit(p) + intercept)."
        }
        if has_forward_test:
            baseline = fit_model(train, target, BASE)
            base_p = baseline.predict_proba(test[BASE])[:, 1]
            pred = model.predict_proba(test[selected_features])[:, 1]
            calibrated_pred = apply_platt(calibrator, pred)
            metrics = evaluate(test, target, pred)
            metrics["auc_95pct_group_bootstrap"] = grouped_auc_interval(test, target, pred, rng)
            calibrated_metrics = evaluate(test, target, calibrated_pred)
            calibrated_metrics["auc_95pct_group_bootstrap"] = grouped_auc_interval(test, target, calibrated_pred, rng)
            baseline_metrics = evaluate(test, target, base_p)
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
            output["calibration_bins"][name] = {
                "raw": calibration_bins(test, target, pred),
                "platt_calibrated": calibration_bins(test, target, calibrated_pred)
            }
            output["subgroups"][name] = {
                "raw": subgroup_report(test, target, pred),
                "platt_calibrated": subgroup_report(test, target, calibrated_pred)
            }
        else:
            metrics = None
            calibrated_metrics = None
            output["comparisons"][name] = {
                "baseline_features": BASE, "baseline_metrics": None,
                "selected_model_metrics": None, "delta_selected_minus_baseline": None,
                "interpretation": f"Forward-only evaluation waits for at least {holdout_min} independent post-cutoff matches."
            }
            output["calibration_bins"][name] = {}
            output["subgroups"][name] = {}
        output["models"][name] = {
            "target": target, "features": selected_features, "metrics": metrics,
            "calibrated_metrics": calibrated_metrics, "calibration": calibration_info,
            "parameters": export_model(model, selected_features)
        }

    # Keep the experimental expected-goals count model strictly offline and
    # evaluate it only when the independent forward holdout is large enough.
    if has_forward_test:
        count_train = prepare_count_features(train)
        count_test = prepare_count_features(test)
        count_targets = {
            "any_goal_remaining": "goals_remaining",
            "home_goal_remaining": "home_goals_remaining",
            "away_goal_remaining": "away_goals_remaining",
        }
        count_features = [
            "minute", "remaining_minutes", "home_score", "away_score", "score_difference",
            "sot_home", "sot_away", "sot_diff", "sot_delta_home", "sot_delta_away",
            "sot_delta_home_per_minute", "sot_delta_away_per_minute",
            "shots_off_home", "shots_off_away", "shots_off_diff",
            "shots_off_delta_home", "shots_off_delta_away",
            "shots_off_delta_home_per_minute", "shots_off_delta_away_per_minute",
            "shots_home", "shots_away", "shots_diff", "shots_delta_home", "shots_delta_away",
            "shots_home_per_minute", "shots_away_per_minute",
            "shots_delta_home_per_minute", "shots_delta_away_per_minute",
            "sot_home_per_minute", "sot_away_per_minute",
            "shots_off_home_per_minute", "shots_off_away_per_minute",
            "possession_home", "possession_away", "possession_diff",
            "possession_delta_home", "possession_delta_away", "interval_seconds"
        ]
        for name, target in count_targets.items():
            baseline = fit_poisson_count(count_train, target, BASE)
            base_lambda = np.clip(baseline.predict(count_test[BASE]), 0, None)
            model = fit_poisson_count(count_train, target, count_features)
            pred_lambda = np.clip(model.predict(count_test[count_features]), 0, None)
            base_metrics = count_metrics(count_test, target, base_lambda)
            extended_metrics = count_metrics(count_test, target, pred_lambda)
            output["poisson_count_models"][name] = {
                "target": target, "features": count_features,
                "baseline_minute_score": base_metrics,
                "extended_live_features": extended_metrics,
                "delta_mae_extended_minus_baseline": float(extended_metrics["mae"] - base_metrics["mae"]),
                "probability_conversion": "P(at least one remaining goal) = 1 - exp(-predicted_expected_goals).",
                "model_family": "HistGradientBoostingRegressor(loss=poisson); experimental offline only."
            }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "match-intelligence-models.json").write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = [
        "# LIVE Match Intelligence – frozen forward-holdout report", "",
        f"Generated UTC: {output['generated_at_utc']}",
        f"Dataset: {len(frame):,} snapshots from {frame.match_id.nunique():,} matches.",
        f"Training: {len(train):,} snapshots from {train.match_id.nunique():,} pre-cutoff matches.",
        f"Forward test: {len(test):,} snapshots from {test.match_id.nunique():,} post-cutoff matches.",
        f"Frozen cutoff UTC: {output['dataset']['holdout_after_utc']}",
        "", "All snapshots from one match stay in one partition; every match has equal total training weight."
    ]
    if has_forward_test:
        lines += ["", "## Independent forward out-of-sample metrics", "",
                  "| Target | Model | AUC | Brier | Log loss | Observed | Predicted |",
                  "|---|---|---:|---:|---:|---:|---:|"]
        for name, item in output["models"].items():
            for label, m in (("Minute + score baseline", output["comparisons"][name]["baseline_metrics"]),
                             ("Selected model", item["metrics"]),
                             ("Selected + OOF Platt calibration", item["calibrated_metrics"])):
                lines.append(f"| {name} | {label} | {m['auc']:.3f} | {m['brier']:.3f} | {m['log_loss']:.3f} | {m['positive_rate_match_weighted']:.3f} | {m['mean_prediction_match_weighted']:.3f} |")
        lines += ["", "## Added feature value vs baseline", "",
                  "| Target | Δ AUC | Δ Brier | Δ Log loss |", "|---|---:|---:|---:|"]
        for name, c in output["comparisons"].items():
            d = c["delta_selected_minus_baseline"]
            lines.append(f"| {name} | {d['auc']:+.3f} | {d['brier']:+.3f} | {d['log_loss']:+.3f} |")
        lines += ["", "## Poisson expected-goals experiment", "",
                  "| Target | Model | Expected goals observed | Predicted | Count MAE | Count RMSE | Derived P(≥1) AUC | Brier |",
                  "|---|---|---:|---:|---:|---:|---:|---:|"]
        for name, item in output["poisson_count_models"].items():
            for label, m in (("Baseline", item["baseline_minute_score"]), ("Extended", item["extended_live_features"])):
                p = m["derived_any_probability_metrics"]
                lines.append(f"| {name} | {label} | {m['observed_mean']:.3f} | {m['predicted_mean']:.3f} | {m['mae']:.3f} | {m['rmse']:.3f} | {p['auc']:.3f} | {p['brier']:.3f} |")
        for name, variants in output["calibration_bins"].items():
            for variant, bins in variants.items():
                lines += ["", f"## Calibration – {name} ({variant})", "",
                          "| Probability band | Snapshots | Mean predicted | Observed |",
                          "|---|---:|---:|---:|"]
                for row in bins:
                    lines.append(f"| {row['lower']:.1f}–{row['upper']:.1f} | {row['rows']} | {row['mean_prediction']:.3f} | {row['observed_rate']:.3f} |")
    else:
        lines += ["", "## Forward validation pending", "",
                  f"No metrics are published until at least {holdout_min} independent matches archived strictly after the frozen cutoff are available.",
                  "Candidate models are fitted only on pre-cutoff matches. The future holdout is not used for fitting, calibration, feature selection, or threshold selection.",
                  "Do not move the cutoff after observing future results."]
    lines += ["", "## Interpretation limits", "",
              "- AUC measures discrimination, not hit rate or profitability.",
              "- Brier and log loss measure probability quality, not betting value.",
              "- No bookmaker odds or executable market prices are included; ROI cannot be inferred.",
              "- No dangerous-attacks feature is used. The models remain isolated from production signals.", ""]
    (OUT / "match-intelligence-training-report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "status": output["model_status"], "dataset": output["dataset"],
        "comparisons": output["comparisons"],
        "poisson_count_models": output["poisson_count_models"]
    }, indent=2))


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
