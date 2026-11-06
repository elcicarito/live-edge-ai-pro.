# LIVE EDGE – prospective model validation protocol

**Protocol frozen at:** 2026-11-06T21:19:00Z  
**Prospective cohort starts:** 2026-11-06T21:30:00Z  
**Status:** preregistered; no production model or signal changes.

## Purpose

Create a genuinely new holdout cohort for testing the candidate next-10-minute goal model. The existing archive and all experiments on it are development data only. Previously reported exploratory metrics are not accepted as proof of an edge.

## Cohort eligibility

A match enters the prospective holdout only when all conditions hold:

1. Its earliest valid snapshot `collected_at` is at or after **2026-11-06T21:30:00Z**.
2. Its `match_id` does not already exist in the development archive at the freeze point.
3. It has a final result and a complete, time-resolved goal-event timeline.
4. Candidate snapshots satisfy the conservative label rules in `scripts/archive-temporal-audit.js`: no same-minute goal ambiguity, snapshot score agrees with the event timeline, and the full next-10-minute window is observable within regulation time.
5. A match is kept as one indivisible unit. No snapshots from one match may appear in both development and prospective holdout data.

Use the earliest snapshot timestamp, not `archived_at`, to determine cohort entry. Archive ingestion time can reflect when a record was written, not when the match was first observed.

## Frozen comparison

- **Baseline:** minute + current home score + current away score.
- **Candidate:** baseline plus fixed match-state indicators (home leading, draw, away leading), fixed time bands (0–15, 16–30, 31–45, 46–60, 61–75, 76–90), and fixed goal-difference bands (0, 1, 2+ in absolute magnitude).
- No feature selection, threshold tuning, or model selection using prospective holdout outcomes.
- Compare ROC AUC, PR AUC, Brier score, log loss, precision, recall, alert count, and match-grouped uncertainty intervals.
- Report results by time band and match state only when sample sizes are shown alongside them.
- A predictive improvement is not betting profitability. No ROI claim is possible without timestamp-aligned odds and a separate execution model.

## Decision gate

Do not activate a LIVE signal from this experiment. First confirm label quality, adequate independent match count, stable out-of-sample improvement over the baseline, and calibration. If sample size is inadequate, continue collecting rather than weakening eligibility rules.

## Operational boundary

This protocol is an offline research specification. It does not change collectors, APIs, collection cadence, scanner behavior, alerts, or production signals.
