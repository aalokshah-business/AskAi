#!/usr/bin/env bash
# Idempotent and non-interactive. A second run changes nothing AskAI already applied.
set -eu
cd "$(dirname "$0")/.."
node askai.js install --yes --profile lean
node askai.js project refresh
