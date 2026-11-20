#!/usr/bin/env python3
"""Collect finished eSoccer FC 27 results from TipManager Valhalla/Valkyrie archives.

This collector is intentionally isolated from the Flashscore football feed.
It stores only completed scores, player handles, clubs and source timestamps.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "live-data-v2" / "esoccer-fc27"
LEAGUES = {
    "valhalla": {
        "name": "Valhalla Cup",
        "id": 49,
        "url": "https://tipmanager.net/en/sports/e-soccer/leagues/49/valhalla-cup",
    },
    "valkyrie": {
        "name": "Valkyrie Cup",
        "id": 48,
        "url": "https://tipmanager.net/en/sports/e-soccer/leagues/48/valkyrie-cup",
    },
}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; LIVE-EDGE-AI-PRO/1.0; results archive)",
    "Accept-Language": "en-US,en;q=0.9",
}
PLAYER_TEAM = re.compile(r"^(.+?)\s+-\s+(.+?)\s+-\s+Clique", re.I)
SCORE = re.compile(r"(?<!\d)(\d{1,2})\s*[–—-]\s*(\d{1,2})(?!\d)")
CLOCK = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")


def fetch(url: str) -> str:
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=25) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {url}")
        return response.read().decode("utf-8", "replace")


def parse_side(anchor):
    label = anchor.get("aria-label", "").strip()
    m = PLAYER_TEAM.match(label)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    # Some page variants expose player and club as separate title attributes.
    player = anchor.get("data-player") or anchor.get("title")
    team = anchor.get("data-team")
    if player and team:
        return str(player).strip(), str(team).strip()
    return None


def parse_matches(html: str, league_key: str, date_hint: str | None) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    found: dict[str, dict] = {}
    for row in soup.find_all(["tr", "li"]):
        anchors = row.find_all("a")
        sides = []
        for a in anchors:
            side = parse_side(a)
            if side:
                sides.append(side)
        if len(sides) < 2:
            continue
        text = row.get_text(" ", strip=True)
        sm = SCORE.search(text)
        if not sm:
            continue
        clock = CLOCK.search(text)
        date_value = date_hint
        if not date_value:
            date_value = datetime.now(timezone.utc).date().isoformat()
        home_player, home_team = sides[0]
        away_player, away_team = sides[1]
        record = {
            "league": league_key,
            "competition": LEAGUES[league_key]["name"],
            "date": date_value,
            "kickoff_time": clock.group(0) if clock else None,
            "home_player": home_player,
            "home_team": home_team,
            "away_player": away_player,
            "away_team": away_team,
            "home_goals": int(sm.group(1)),
            "away_goals": int(sm.group(2)),
            "source": "TipManager",
        }
        key = "|".join([
            league_key, date_value, record["kickoff_time"] or "",
            home_player.casefold(), away_player.casefold(),
            str(record["home_goals"]), str(record["away_goals"]),
        ])
        found[key] = record
    return list(found.values())


def discover_archive_dates(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    dates = set()
    for a in soup.find_all("a", href=True):
        path = urlparse(urljoin(base_url, a["href"])).path
        m = re.search(r"/(20\d{2}-\d{2}-\d{2})/?$", path)
        if m:
            dates.add(m.group(1))
    return sorted(dates)


def player_summary(matches: list[dict]) -> list[dict]:
    stats = defaultdict(lambda: {
        "player": "", "league": "", "matches": 0, "goals_for": 0,
        "goals_against": 0, "wins": 0, "draws": 0, "losses": 0,
        "recent": [],
    })
    for m in sorted(matches, key=lambda x: (x["date"], x.get("kickoff_time") or "")):
        for side in ("home", "away"):
            player = m[f"{side}_player"]
            key = (m["league"], player.casefold())
            s = stats[key]
            s["player"], s["league"] = player, m["league"]
            gf, ga = m[f"{side}_goals"], m["away_goals" if side == "home" else "home_goals"]
            s["matches"] += 1
            s["goals_for"] += gf
            s["goals_against"] += ga
            s["wins"] += int(gf > ga)
            s["draws"] += int(gf == ga)
            s["losses"] += int(gf < ga)
            s["recent"].append({"date": m["date"], "time": m.get("kickoff_time"), "gf": gf, "ga": ga})
    result = []
    for s in stats.values():
        n = s["matches"]
        s["avg_goals_for"] = round(s["goals_for"] / n, 3) if n else 0
        s["avg_goals_against"] = round(s["goals_against"] / n, 3) if n else 0
        s["goal_difference"] = s["goals_for"] - s["goals_against"]
        s["recent"] = s["recent"][-10:]
        result.append(s)
    return sorted(result, key=lambda x: (x["league"], -x["matches"], x["player"].casefold()))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    all_matches: dict[str, dict] = {}
    diagnostics = {}
    for league_key, league in LEAGUES.items():
        main_html = fetch(league["url"])
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        month_url = league["url"].rstrip("/") + "/" + month
        month_html = fetch(month_url)
        dates = sorted(set(
            discover_archive_dates(main_html, league["url"])
            + discover_archive_dates(month_html, month_url)
        ))
        # Current feed plus every daily archive page linked from this month's archive.
        pages = [(None, league["url"])]
        pages += [(d, league["url"].rstrip("/") + "/" + d) for d in dates]
        league_count = 0
        for date_hint, url in pages:
            try:
                html = main_html if date_hint is None else fetch(url)
                rows = parse_matches(html, league_key, date_hint)
                for row in rows:
                    key = "|".join([
                        row["league"], row["date"], row.get("kickoff_time") or "",
                        row["home_player"].casefold(), row["away_player"].casefold(),
                        str(row["home_goals"]), str(row["away_goals"]),
                    ])
                    all_matches[key] = row
                league_count += len(rows)
                if date_hint is not None:
                    time.sleep(0.5)
            except Exception as exc:
                print(f"WARN {league_key} {url}: {exc}", file=sys.stderr)
        diagnostics[league_key] = {
            "archive_pages_seen": len(pages),
            "parsed_rows_before_dedupe": league_count,
            "date_pages": dates,
        }

    if not all_matches:
        raise RuntimeError("No match rows parsed; refusing to overwrite existing archive.")

    matches = sorted(all_matches.values(), key=lambda x: (x["date"], x.get("kickoff_time") or "", x["league"]))
    players = player_summary(matches)
    now = datetime.now(timezone.utc).isoformat()
    payloads = {
        "matches.json": {"updated_at": now, "source": "TipManager", "matches": matches},
        "players.json": {"updated_at": now, "players": players},
        "meta.json": {
            "updated_at": now,
            "source": "TipManager",
            "scope": "Valhalla Cup + Valkyrie Cup",
            "matches_total": len(matches),
            "players_total": len(players),
            "diagnostics": diagnostics,
            "note": "Historical results are imported from exposed daily archive pages. The source page refreshes about every five minutes.",
        },
    }
    for name, payload in payloads.items():
        (OUT / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payloads["meta.json"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
