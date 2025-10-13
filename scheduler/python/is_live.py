#!/usr/bin/env python3

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from dateutil import parser as date_parser
from googleapiclient.discovery import build
from google.auth import default as google_auth_default
from google.oauth2.service_account import Credentials as ServiceAccountCredentials


def load_config(config_path: str) -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_calendar_id(sheet_key: Optional[str], calendar_id_arg: Optional[str], config_path: str) -> str:
    if calendar_id_arg:
        return calendar_id_arg

    if not sheet_key:
        raise SystemExit("either --calendar-id or --sheet must be provided")

    config = load_config(config_path)
    sheets = config.get("sheets", {})
    sheet_cfg = sheets.get(sheet_key)
    if not sheet_cfg or not sheet_cfg.get("calendarId"):
        raise SystemExit(f"calendarId not found for sheet {sheet_key} in {config_path}")
    return sheet_cfg["calendarId"]


def get_credentials():
    key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    scopes = ["https://www.googleapis.com/auth/calendar.readonly"]
    if key_path and os.path.isfile(key_path):
        return ServiceAccountCredentials.from_service_account_file(key_path, scopes=scopes)
    creds, _ = google_auth_default(scopes=scopes)
    return creds


def parse_rfc3339(dt_str: str) -> datetime:
    return date_parser.parse(dt_str)


def event_is_now(ev: dict, now: datetime) -> bool:
    start = ev.get("start", {})
    end = ev.get("end", {})

    # Ignore all-day events (date vs dateTime)
    if start.get("date") or end.get("date"):
        return False

    if not start.get("dateTime") or not end.get("dateTime"):
        return False

    start_dt = parse_rfc3339(start["dateTime"]).astimezone(timezone.utc)
    end_dt = parse_rfc3339(end["dateTime"]).astimezone(timezone.utc)
    now_utc = now.astimezone(timezone.utc)

    return start_dt <= now_utc < end_dt


def check_is_live(calendar_id: str, lookback_minutes: int = 720) -> bool:
    creds = get_credentials()
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)

    now = datetime.now(timezone.utc)
    time_min = (now - timedelta(minutes=lookback_minutes)).isoformat()
    time_max = (now + timedelta(minutes=1)).isoformat()

    page_token = None
    while True:
        resp = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=50,
                pageToken=page_token,
            )
            .execute()
        )

        for ev in resp.get("items", []):
            if event_is_now(ev, now):
                return True

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return False


def main():
    parser = argparse.ArgumentParser(description="Print 'is live' if a calendar has an in-progress event, else 'is off'.")
    parser.add_argument("--calendar-id", help="Google Calendar ID to query")
    parser.add_argument("--sheet", choices=["A", "B", "C", "D"], help="Sheet key to resolve calendarId from scheduler/config.json")
    parser.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "..", "config.json"), help="Path to scheduler/config.json")
    parser.add_argument("--lookback-minutes", type=int, default=720, help="How far back to search for events that might span 'now'")
    args = parser.parse_args()

    calendar_id = resolve_calendar_id(args.sheet, args.calendar_id, os.path.abspath(args.config))
    is_live = check_is_live(calendar_id, lookback_minutes=args.lookback_minutes)
    print("is live" if is_live else "is off")


if __name__ == "__main__":
    main()
