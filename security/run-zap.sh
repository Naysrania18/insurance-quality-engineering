#!/usr/bin/env bash
# Run the OWASP ZAP API scan against the LOCAL services only (never a remote host).
# Usage: security/run-zap.sh            (requires Docker and a running stack on localhost:3001-3003)
set -euo pipefail

HOST="${ZAP_TARGET_HOST:-localhost}"
case "$HOST" in
  localhost|127.0.0.1) ;;
  *) echo "Refusing to scan '$HOST': this script only scans localhost." >&2; exit 2 ;;
esac

mkdir -p reports/zap
chmod 777 reports/zap 2>/dev/null || true
for svc in "quote:3001" "policy:3002" "claims:3003"; do
  name="${svc%%:*}"; port="${svc##*:}"
  docker run --rm --network host -v "$(pwd)/reports/zap:/zap/wrk:rw" -v "$(pwd)/security:/zap/rules:ro" \
    ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py \
    -t "http://${HOST}:${port}/openapi.yaml" -f openapi \
    -c /zap/rules/zap-rules.conf \
    -r "${name}.html" -J "${name}.json" -w "${name}.md" -I || true
done
npx tsx scripts/zap-gate.ts
