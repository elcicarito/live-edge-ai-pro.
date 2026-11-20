#!/usr/bin/env python3
"""Read-only Flashscore eSports probe: inspect today's schedule and live rows."""
from __future__ import annotations
import json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "live-data-v2" / "esoccer-fc27"
SCRAPER_PATH = os.getenv("FLASHSCORE_SCRAPER_PATH", "/tmp/flashscore-scraper")
TERMS = ("esoccer", "e-soccer", "efootball", "e-football", "fc 27", "fc27",
         "fifa", "volta", "valhalla", "valkyrie", "soccer")

def now():
    return datetime.now(timezone.utc).isoformat()

def text(v):
    if isinstance(v, dict):
        return str(v.get("name") or v.get("short_name") or "")
    return str(v or "")

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    checked = now()
    status = {
        "state": "error", "checked_at": checked,
        "source": "Flashscore Scraper · sport esports (36)",
        "sport_id": 36, "feed_events": 0, "live_events": 0,
        "candidate_events": 0, "schedule_candidates": 0,
        "message": "Kontrola sa ešte nedokončila.", "error": None
    }
    live_candidates, schedule_candidates, rows = [], [], []
    try:
        if not Path(SCRAPER_PATH).exists():
            raise RuntimeError("Flashscore scraper checkout sa nenašiel.")
        sys.path.insert(0, SCRAPER_PATH)
        from flashscore.matches import get_matches
        payload = get_matches("esports")
        groups = payload.get("competitions") or []
        for group in groups:
            competition = group.get("competition") or {}
            comp_name = text(competition.get("name"))
            country = text(competition.get("country"))
            for item in (group.get("matches") or []):
                home, away = text(item.get("home")), text(item.get("away"))
                row = {
                    "id": item.get("id"),
                    "competition": comp_name,
                    "country": country,
                    "home": home, "away": away,
                    "home_score": item.get("home_score"),
                    "away_score": item.get("away_score"),
                    "status": item.get("status"),
                    "stage": item.get("stage"),
                    "start_time": item.get("start_time"),
                    "link": item.get("link"),
                    "source": "Flashscore",
                    "observed_at": checked
                }
                rows.append(row)
                haystack = " ".join((comp_name, country, home, away)).casefold()
                if any(term in haystack for term in TERMS):
                    if str(row.get("status") or "").casefold() == "live":
                        live_candidates.append(row)
                    else:
                        schedule_candidates.append(row)
        live_rows = [r for r in rows if str(r.get("status") or "").casefold() == "live"]
        status.update({
            "state": "ok" if live_candidates else ("schedule_only" if schedule_candidates else "no_matching_events"),
            "feed_events": len(rows),
            "live_events": len(live_rows),
            "candidate_events": len(live_candidates),
            "schedule_candidates": len(schedule_candidates),
            "competition_count": len(groups),
            "message": (
                "Našli sa živé kandidátske zápasy eSoccer/FC27."
                if live_candidates else
                "Našli sa názvy eSoccer/FC27 v dnešnom programe, ale nie medzi živými zápasmi."
                if schedule_candidates else
                "Denný Flashscore eSports program odpovedal, ale neobsahuje rozpoznané eSoccer/FC27 názvy."
            ),
            "error": None
        })
        (OUT / "flashscore-live.json").write_text(json.dumps({
            "updated_at": checked, "source": status["source"],
            "matches": live_candidates,
            "schedule_candidates": schedule_candidates,
            "esports_sample": rows[:40]
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        status["state"] = "error"
        status["message"] = "Flashscore eSports kontrola zlyhala; klasický futbal nebol zmenený."
        status["error"] = f"{type(exc).__name__}: {exc}"[:400]
    (OUT / "flashscore-status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(status, ensure_ascii=False))

if __name__ == "__main__":
    main()
