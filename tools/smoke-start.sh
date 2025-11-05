#!/usr/bin/env bash
set -euo pipefail

# Usage examples:
#   ./tools/smoke-start.sh --title "Test Broadcast" --description "Quick E2E" --privacy public --stream-key "$YOUTUBE_STREAM_KEY"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TITLE=""
DESCRIPTION=""
PRIVACY="public"
STREAM_ID=""
STREAM_KEY="${YOUTUBE_STREAM_KEY:-}"
CREDENTIALS="${YOUTUBE_OAUTH_CREDENTIALS:-}"
OBS_PROFILE="${OBS_PROFILE:-Untitled}"
OBS_COLLECTION="${OBS_COLLECTION:-Static Game Stream}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2;;
    --description) DESCRIPTION="$2"; shift 2;;
    --privacy) PRIVACY="$2"; shift 2;;
    --stream-id) STREAM_ID="$2"; shift 2;;
    --stream-key) STREAM_KEY="$2"; shift 2;;
    --credentials) CREDENTIALS="$2"; shift 2;;
    --profile) OBS_PROFILE="$2"; shift 2;;
    --collection) OBS_COLLECTION="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

if [[ -z "$TITLE" ]]; then
  echo "--title is required" >&2
  exit 1
fi

if [[ -z "$STREAM_ID" && -z "$STREAM_KEY" ]]; then
  echo "Provide --stream-id or --stream-key (or set YOUTUBE_STREAM_KEY)" >&2
  exit 1
fi

if [[ -n "$CREDENTIALS" && ! -f "$CREDENTIALS" ]]; then
  echo "YouTube OAuth credentials not found: $CREDENTIALS" >&2
  exit 1
fi

echo "Creating YouTube broadcast via scheduler..."
NPM_ARGS=(--prefix "$REPO_ROOT/scheduler" run yt-create -- --title "$TITLE")
if [[ -n "$DESCRIPTION" ]]; then NPM_ARGS+=(--description "$DESCRIPTION"); fi
if [[ -n "$PRIVACY" ]]; then NPM_ARGS+=(--privacy "$PRIVACY"); fi
if [[ -n "$STREAM_ID" ]]; then NPM_ARGS+=(--stream-id "$STREAM_ID"); fi
if [[ -n "$STREAM_KEY" ]]; then NPM_ARGS+=(--stream-key "$STREAM_KEY"); fi
if [[ -n "$CREDENTIALS" ]]; then NPM_ARGS+=(--credentials "$CREDENTIALS"); fi

npm "${NPM_ARGS[@]}"

OBS_APP="/Applications/OBS.app"
if [[ ! -d "$OBS_APP" ]]; then
  echo "OBS is not installed at $OBS_APP" >&2
  exit 1
fi

echo "Launching OBS with profile '$OBS_PROFILE' and collection '$OBS_COLLECTION'..."
open -a "OBS" --args --profile "$OBS_PROFILE" --collection "$OBS_COLLECTION" --startstreaming
echo "Smoke start issued. If OBS was already running, it will reuse the same instance."




