#!/bin/bash
# Patient, resumable runtime/gross backfill with cooldown-aware retries.
# Runs backfill.py until no movies remain with NULL runtime (or 0-marker).
# When TMDB throttles the network, backfill makes little progress and we
# wait 15 minutes before trying again (avoids extending the throttle).
cd /Users/harshsingh/Documents/personal/FlickFindr/tools/load-backend

check_remaining() {
  .venv/bin/python - <<'PY'
import sys; sys.path.insert(0, '.')
from load import _cfg
import psycopg
_, _, url = _cfg()
with psycopg.connect(url) as c:
    n = c.execute("SELECT count(*) FROM movies WHERE tmdb_id IS NOT NULL AND runtime IS NULL").fetchone()[0]
print(n)
PY
}

attempts=0
while :; do
  remaining=$(check_remaining)
  echo "[$(date '+%H:%M:%S')] remaining NULL-runtime movies: $remaining"
  if [ "$remaining" -le 0 ]; then
    echo "Backfill complete — no movies missing runtime."
    exit 0
  fi
  before=$remaining
  .venv/bin/python backfill.py --concurrency 3 >> /tmp/backfill-auto.log 2>&1
  after=$(check_remaining)
  echo "[$(date '+%H:%M:%S')] pass done: $before -> $after remaining"
  if [ "$after" -ge "$before" ] && [ "$before" -gt 0 ]; then
    echo "No progress (TMDB likely throttling). Cooling down 15 min..."
    sleep 900
  elif [ "$after" -le 0 ]; then
    echo "Backfill complete."
    exit 0
  else
    sleep 20
  fi
  attempts=$((attempts+1))
  if [ "$attempts" -ge 200 ]; then
    echo "Gave up after many attempts; re-run me later."
    exit 1
  fi
done
