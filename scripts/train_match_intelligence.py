#!/usr/bin/env python3
"""Train experimental full-time remaining-goal models from the isolated LIVE archive dataset."""
import json
import os
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
    model.fit(
        train[features],
        train[target].astype(int),
        model__sample_weight=match_weights(train),
    )
    return model


def export_model(model, features):
    imputer = model.named_steps["impute"]
    scaler = model.named_steps["scale"]
    logistic = model.named_steps["model"]
    indicators = (
        imputer.indicator_.features_.astype(int).tolist()
        if imputer.add_indicator and imputer.indicator_ is not None else []
    )
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
            indices = by_group[group]
            ys.append(y[indices])
            ps.append(probabilities[indices])
            ws.append(np.full(len(indices), 1.0 / len(indices)))
        yy, pp, ww = np.concatenate(ys), np.concatenate(ps), np.concatenate(ws)
        if np.unique(yy).size < 2:
            continue
        values.append(float(roc_auc_score(yy, pp, sample_weight=ww)))
    if not values:
        return None
    return [float(x) for x in np.quantile(values, [0.025, 0.5, 0.975])]


def evaluate(frame, target, probabilities):
    weights = match_weights(frame).to_numpy()
    y = frame[target].astype(int).to_numpy()
    return {
        "rows": int(len(frame)),
        "matches": int(frame["match_id"].nunique()),
        "positive_rate_match_weighted": float(np.average(y, weights=weights)),
        "mean_prediction_match_weighted": float(np.average(probabilities, weights=weights)),
        "auc": float(roc_auc_score(y, probabilities, sample_weight=weights)),
        "auc_95pct_group_bootstrap": None,
        "brier": float(brier_score_loss(y, probabilities, sample_weight=weights)),
        "log_loss": float(log_loss(y, probabilities, sample_weight=weights)),
        "accuracy_at_0_50": float(accuracy_score(y, probabilities >= 0.5, sample_weight=weights)),
    }


def calibration_bins(frame, target, probabilities):
    weights = match_weights(frame).to_numpy()
    y = frame[target].astype(int).to_numpy()
    result = []
    edges = np.linspace(0, 1, 11)
    for index in range(10):
        mask = (probabilities >= edges[index]) & (
            probabilities < edges[index + 1] if index < 9 else probabilities <= 1
        )
        if not mask.any():
            continue
        result.append({
            "lower": round(float(edges[index]), 1),
            "upper": round(float(edges[index + 1]), 1),
            "rows": int(mask.sum()),
            "mean_prediction": round(float(np.average(probabilities[mask], weights=weights[mask])), 3),
            "observed_rate": round(float(np.average(y[mask], weights=weights[mask])), 3),
        })
    return result


def main():
    if not INPUT.exists():
        raise SystemExit(f"Dataset not found: {INPUT}")
    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    frame = pd.DataFrame(payload.get("rows", []))
    if frame.empty or "dataset_split" not in frame:
        raise SystemExit("Dataset is empty or missing dataset_split.")
    train = frame[frame["dataset_split"] == "train"].copy()
    test = frame[frame["dataset_split"] == "test"].copy()
    if train["match_id"].nunique() < 100 or test["match_id"].nunique() < 50:
        raise SystemExit("Insufficient independent matches for a first out-of-sample experiment.")

    rng = np.random.default_rng(SEED)
    output = {
        "model_status": "EXPERIMENTAL_OUT_OF_SAMPLE_NOT_FOR_BETTING",
        "generated_at_utc": pd.Timestamp.now(tz="UTC").isoformat(),
        "sklearn_version": sklearn.__version__,
        "dataset": {
            "rows": int(len(frame)),
            "matches": int(frame["match_id"].nunique()),
            "train_rows": int(len(train)),
            "train_matches": int(train["match_id"].nunique()),
            "test_rows": int(len(test)),
            "test_matches": int(test["match_id"].nunique()),
            "split": "The dataset builder assigns every snapshot from one match to a single chronological train/test partition.",
        },
        "weighting": "Each match contributes equal total weight, preventing matches with more snapshots from dominating the fit or reported metrics.",
        "models": {},
        "calibration_bins_any_goal": [],
        "limitations": [
            "No bookmaker odds are included; no value or ROI conclusion is possible.",
            "The test set contains repeated snapshots from 319 held-out matches; grouped bootstrap intervals resample matches, not individual rows.",
            "Logistic probabilities are evaluated for calibration but no separate calibration layer is fitted.",
            "No dangerous-attacks feature is used.",
            "This model is experimental and is not connected to production signals.",
        ],
    }

    for name, (target, features) in TARGETS.items():
        model = fit_model(train, target, features)
        probabilities = model.predict_proba(test[features])[:, 1]
        metrics = evaluate(test, target, probabilities)
        metrics["auc_95pct_group_bootstrap"] = grouped_auc_interval(test, target, probabilities, rng)
        output["models"][name] = {
            "target": target,
            "features": features,
            "metrics": metrics,
            "parameters": export_model(model, features),
        }
        if name == "any_goal_remaining":
            output["calibration_bins_any_goal"] = calibration_bins(test, target, probabilities)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "match-intelligence-models.json").write_text(
        json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    lines = [
        "# LIVE Match Intelligence – first out-of-sample experiment",
        "",
        f"Generated UTC: {output['generated_at_utc']}",
        f"Dataset: {len(frame):,} snapshots from {frame['match_id'].nunique():,} matches.",
        f"Train/test: {len(train):,} / {len(test):,} snapshots; "
        f"{train['match_id'].nunique():,} / {test['match_id'].nunique():,} matches.",
        "",
        "Each match has equal total weight. All snapshots from a match remain in one split.",
        "",
        "| Target | AUC | 95% grouped CI | Brier | Log loss | Match-weighted observed | Match-weighted predicted |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name, item in output["models"].items():
        m = item["metrics"]
        ci = m["auc_95pct_group_bootstrap"] or []
        ci_text = f"{ci[0]:.3f}–{ci[2]:.3f}" if len(ci) == 3 else "—"
        lines.append(
            f"| {name} | {m['auc']:.3f} | {ci_text} | {m['brier']:.3f} | "
            f"{m['log_loss']:.3f} | {m['positive_rate_match_weighted']:.3f} | "
            f"{m['mean_prediction_match_weighted']:.3f} |"
        )
    lines += [
        "",
        "## Calibration diagnostic – any goal remaining",
        "",
        "| Predicted probability bin | Snapshots | Mean prediction | Observed rate |",
        "|---|---:|---:|---:|",
    ]
    for row in output["calibration_bins_any_goal"]:
        lines.append(
            f"| {row['lower']:.1f}–{row['upper']:.1f} | {row['rows']} | "
            f"{row['mean_prediction']:.3f} | {row['observed_rate']:.3f} |"
        )
    lines += [
        "",
        "## Interpretation limits",
        "",
        "- These are out-of-sample discrimination and calibration diagnostics, not betting results.",
        "- No odds, bookmaker margin, market availability, or staking outcomes are in the dataset.",
        "- Do not publish alerts or treat the outputs as betting recommendations until additional validation and odds-based evaluation.",
        "",
    ]
    (OUT / "match-intelligence-training-report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "status": output["model_status"],
        "dataset": output["dataset"],
        "metrics": {k: v["metrics"] for k, v in output["models"].items()},
    }, indent=2))


if __name__ == "__main__":
    main()
