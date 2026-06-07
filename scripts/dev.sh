#!/usr/bin/env bash
# Start automation-api (8081) and web (4200) together.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "warning: .env not found — copy .env.example to .env if the API fails to start." >&2
fi

echo "API:  http://127.0.0.1:8081  (Swagger: /docs)"
echo "Web:  http://127.0.0.1:4200  (proxies /api -> API)"
echo ""
echo "Starting both services (Ctrl+C to stop)..."
pnpm run dev
