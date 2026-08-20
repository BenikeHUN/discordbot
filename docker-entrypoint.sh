#!/bin/sh
set -e

# YouTube breaks yt-dlp every few weeks. Pulling the current nightly on start
# means a restart fixes playback without rebuilding the image.
if [ "$UPDATE_YTDLP_ON_START" = "true" ]; then
  node /app/scripts/setup-ytdlp.js || true
fi

exec "$@"
