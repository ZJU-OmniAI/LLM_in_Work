#!/bin/bash
# Register LLM_in_PDF's native bridge on macOS/Linux.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.13+ first.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22 || (Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) < 13)) process.exit(1)' || { echo 'Node.js 22.13+ required.' >&2; exit 1; }
exec node tools/install.mjs "$@"
