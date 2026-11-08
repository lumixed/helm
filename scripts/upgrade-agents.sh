#!/usr/bin/env bash
# Ship a new version of the Helm agent:
#   1. bundle agent/ and build it on Maritime as a release agent named helm-image-<version>,
#   2. move every student agent (user_<uuid>) onto that image. /data is kept.
# With MARITIME_AGENT_IMAGE=auto, new sign-ups pick up the release automatically.
#
# Usage:
#   export MARITIME_API_KEY=mk_...
#   scripts/upgrade-agents.sh v0-4            # build + upgrade all students
#   scripts/upgrade-agents.sh v0-4 --build-only
set -euo pipefail

VERSION="${1:?usage: scripts/upgrade-agents.sh <version, e.g. v0-4> [--build-only]}"
BUILD_ONLY="${2:-}"
API="${MARITIME_API_URL:-https://api.maritime.sh}"
: "${MARITIME_API_KEY:?Set MARITIME_API_KEY (mk_...)}"
export MARITIME_TOKEN="$MARITIME_API_KEY"
auth=(-H "Authorization: Bearer $MARITIME_API_KEY")
cd "$(dirname "$0")/.."

status_of() { curl -fsS "${auth[@]}" "$API/api/agents/$1" | jq -r '.status'; }

echo "== Bundle agent"
pnpm --filter @helm/agent build

NAME="helm-image-$VERSION"
echo "== Build $NAME on Maritime (a few minutes)"
# The CLI prints an "uploaded source as ..." line before the JSON.
out=$(maritime agents create --name "$NAME" --framework custom --from-dir agent/.deploy --idle-ttl-seconds 60 --json | sed -n '/^{/,$p')
REL=$(echo "$out" | jq -r '.results.data.id // .results.id // .data.id // .id')
[[ "$REL" != null && -n "$REL" ]] || { echo "Create failed: $out" >&2; exit 1; }
for _ in $(seq 1 60); do
  s=$(status_of "$REL")
  [[ "$s" != deploying ]] && break
  sleep 10
done
[[ "$s" == active || "$s" == sleeping ]] || { echo "Build ended with status $s; see: maritime history $NAME" >&2; exit 1; }
IMG=$(curl -fsS "${auth[@]}" "$API/api/agents/$REL" | jq -r '.imageName')
echo "Image: $IMG"
[[ "$BUILD_ONLY" == --build-only ]] && exit 0

echo "== Upgrade student agents"
curl -fsS "${auth[@]}" "$API/api/agents" |
  jq -r --arg img "$IMG" '(if type == "array" then . else .results end)[]
    | select(.name | test("^user_[0-9a-f-]{36}$")) | select(.imageName != $img) | .id' |
  while read -r id; do
    echo "-- $id"
    # Per-agent Maritime LLM token (spend capped by the end-user policy). Applied by the redeploy.
    [[ "${MARITIME_LLM:-on}" == off ]] || curl -fsS -X POST "${auth[@]}" "$API/api/agents/$id/reset-llm" >/dev/null || echo "   (Maritime LLM not enabled)"
    maritime deploy "$id" --source docker --image "$IMG" --wait >/dev/null && echo "   ok ($(status_of "$id"))" || echo "   FAILED (see maritime history $id)"
  done
echo "Done."
