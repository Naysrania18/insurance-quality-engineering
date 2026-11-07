#!/usr/bin/env bash
# Wait until all four HTTP services of the docker-compose stack answer /health.
set -euo pipefail
for url in http://localhost:3001/health http://localhost:3002/health http://localhost:3003/health http://localhost:3000/health; do
  for i in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then echo "up: $url"; break; fi
    if [ "$i" = 90 ]; then echo "timed out waiting for $url" >&2; docker compose logs --tail=50 >&2 || true; exit 1; fi
    sleep 2
  done
done
