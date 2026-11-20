#!/usr/bin/env python3
"""Read-only Flashscore eSports live probe, isolated from classic football."""
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
        "sport_id": 36, "feed_events": 0, "candidate_events": 0,
        "message": "Kontrola sa ešte nedokončila.", "error": None
    }
    matches_out = []
    try:
        if not Path(SCRAPER_PATH).exists():
            raise RuntimeError("Flashscore scraper checkout sa nenašiel.")
        sys.path.insert(0, SCRAPER_PATH)
        from flashscore.matches import get_live_matches
        payload = get_live_matches("esports")
        groups = payload.get("competitions") or []
        rows = []
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
                    matches_out.append(row)
        status.update({
            "state": "ok" if matches_out else "no_matching_events",
            "feed_events": len(rows),
            "candidate_events": len(matches_out),
            "competition_count": len(groups),
            "message": (
                "Flashscore eSports feed vrátil zápasy a našli sa kandidáti eSoccer/FC27."
                if matches_out else
                "Flashscore eSports feed odpovedal, ale nenašli sa názvy eSoccer/FC27/Volta. Samotné eSports ešte nepotvrdzuje Volta."
            ),
            "error": None
        })
        (OUT / "flashscore-live.json").write_text(json.dumps({
            "updated_at": checked, "source": status["source"],
            "matches": matches_out, "esports_sample": rows[:40]
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        status["state"] = "error"
        status["message"] = "Flashscore eSports kontrola zlyhala; klasický futbal nebol zmenený."
        status["error"] = f"{type(exc).__name__}: {exc}"[:400]
    (OUT / "flashscore-status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(status, ensure_ascii=False))
    # Diagnostic failures are published as status, not treated as fake matches.

if __name__ == "__main__":
    main()
