#!/bin/sh
set -e
cd /app || exit 1
CFG="${RUNTIME_CONFIG:-/app/apps/runtime/config/docker.stack.example.yaml}"
pnpm --filter @opencoreagents/runtime exec tsx src/cli.ts env "$CFG" --strict > /tmp/runtime-stack.env
set -a
# shellcheck disable=SC1090
. /tmp/runtime-stack.env
set +a
cd /app/apps/runtime || exit 1
exec "$@"
