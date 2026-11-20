#!/usr/bin/env python3
"""One-shot, read-only AURA-Py / 1xBet virtual football feed probe.

This does not reuse AURA-Py's threaded SQLite monitor. It publishes only
source-returned live events and a truthful health/status document for the app.
"""
from __future__ import annotations
import json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "live-data-v2" / "esoccer-fc27"
BASE = os.getenv("AURA_API_BASE_URL", "https://9wjrwctd2j.com").rstrip("/")
SPORTS_ID = os.getenv("AURA_SPORTS_ID", "85")
COUNTRY_ID = os.getenv("AURA_COUNTRY_ID", "169")
PARTNER_ID = os.getenv("AURA_PARTNER_ID", "36")
TERMS = ("fifa", "e-soccer", "esoccer", "volta", "fc 27", "fc27", "cyber")

def now():
    return datetime.now(timezone.utc).isoformat()

def get_json(url):
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; LIVE-EDGE-AI-PRO/1.0)",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urlopen(req, timeout=18) as response:
        return json.loads(response.read().decode("utf-8", "replace"))

def score_parts(match):
    sc = match.get("SC") or {}
    fs = sc.get("FS") or {}
    return fs.get("S1"), fs.get("S2")

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    checked = now()
    query = urlencode({
        "sports": SPORTS_ID, "count": "40", "lng": "en", "gr": "666",
        "mode": "4", "country": COUNTRY_ID, "partner": PARTNER_ID,
        "getEmpty": "true", "virtualSports": "true",
        "noFilterBlockEvent": "true",
    })
    url = f"{BASE}/service-api/LiveFeed/Get1x2_VZip?{query}"
    try:
        payload = get_json(url)
        values = payload.get("Value") if isinstance(payload, dict) else None
        if not isinstance(values, list):
            raise RuntimeError("API odpovedala, ale neobsahuje očakávané pole Value.")
        matches = []
        for item in values:
            if not isinstance(item, dict):
                continue
            league = str(item.get("L") or item.get("LE") or "")
            home = str(item.get("O1") or "")
            away = str(item.get("O2") or "")
            haystack = " ".join((league, home, away)).casefold()
            if not any(term in haystack for term in TERMS):
                continue
            h, a = score_parts(item)
            sc = item.get("SC") or {}
            matches.append({
                "id": str(item.get("I") or ""),
                "league": league or "Neznáma súťaž",
                "home": home or "Neznámy hráč",
                "away": away or "Neznámy hráč",
                "home_goals": h, "away_goals": a,
                "clock_seconds": sc.get("TS"),
                "period": sc.get("CP"),
                "status": sc.get("I"),
                "source": "AURA-Py / 1xBet virtual feed",
                "observed_at": checked,
            })
        status = {
            "state": "ok" if matches else "no_matching_events",
            "checked_at": checked,
            "source": "AURA-Py / 1xBet virtual feed",
            "api_base": BASE,
            "feed_events": len(values),
            "esoccer_events": len(matches),
            "message": ("Našli sa živé FIFA/eSoccer udalosti." if matches else
                        "Feed odpovedal, ale vrátené udalosti neobsahujú rozpoznané FIFA/eSoccer/Volta názvy."),
            "error": None,
        }
        (OUT / "aura-live.json").write_text(json.dumps({
            "updated_at": checked, "source": status["source"], "matches": matches
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except HTTPError as exc:
        status = {"state":"error","checked_at":checked,"source":"AURA-Py / 1xBet virtual feed",
                  "api_base":BASE,"feed_events":0,"esoccer_events":0,
                  "message":f"Zdroj odmietol požiadavku (HTTP {exc.code}).",
                  "error":f"HTTP {exc.code}"}
    except (URLError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
        status = {"state":"error","checked_at":checked,"source":"AURA-Py / 1xBet virtual feed",
                  "api_base":BASE,"feed_events":0,"esoccer_events":0,
                  "message":"Nepodarilo sa načítať verejný feed.",
                  "error":str(exc)[:350]}
    (OUT / "aura-status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(status, ensure_ascii=False))
    # A failed probe is still a successful diagnostic run: publish its status.
    if status["state"] == "error":
        return 0

if __name__ == "__main__":
    main()
