#!/usr/bin/env bash
# Gate G1 spike (PRD section 8): deploy the hello-world Helm agent to Maritime and prove
#   1. it builds and boots as a custom container,
#   2. it answers chat,
#   3. it is reachable by webhook (and shows how the webhook body arrives at POST /chat),
#   4. Maritime picked up its GET /schedules entries.
#
# Usage:
#   export MARITIME_API_KEY=mk_...
#   scripts/g1-spike.sh [agent-name]
#
# Agent -> backend calls (step 4) are covered by the app's own provisioning, which gives each
# student's agent its token. This script only proves the platform contract.
#
# Record what you see in docs/maritime-notes.md.
set -euo pipefail

NAME="${1:-helm-g1}"
STUDENT_ID="${HELM_STUDENT_ID:-g1_spike}"
API="${MARITIME_API_URL:-https://api.maritime.sh}"
: "${MARITIME_API_KEY:?Set MARITIME_API_KEY (mk_...)}"
export MARITIME_TOKEN="$MARITIME_API_KEY"

cd "$(dirname "$0")/.."
auth=(-H "Authorization: Bearer $MARITIME_API_KEY")
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "Bundle agent"
pnpm --filter @helm/agent build

step "Create agent '$NAME' from agent/.deploy"
if existing=$(maritime list --json 2>/dev/null | jq -er --arg n "$NAME" '(.results // .)[] | select(.name == $n) | .id' 2>/dev/null); then
  # Redeploying a ZIP source onto an existing agent is not documented yet; recreate instead.
  echo "Agent '$NAME' already exists ($existing). To rebuild it from fresh source:"
  echo "  maritime delete $NAME --yes && $0 $NAME"
  AGENT_ID="$existing"
else
  out=$(maritime agents create --name "$NAME" --framework custom --from-dir agent/.deploy \
    --external-id "$STUDENT_ID" --idle-ttl-seconds 300 --json)
  echo "$out" | jq '.results // .' | head -40
  AGENT_ID=$(echo "$out" | jq -r '.results.data.id // .results.id // .data.id // .id')
fi
echo "AGENT_ID=$AGENT_ID"

step "Wait for the agent to be ready"
for _ in $(seq 1 72); do
  status=$(curl -fsS "${auth[@]}" "$API/api/agents/$AGENT_ID" | jq -r '.status // .results.status')
  echo "status=$status"
  case "$status" in
    running | sleeping | idle | ready) break ;;
    error | failed) maritime history "$NAME" --json | jq -r '.[0].buildLog // .results[0].buildLog' | tail -40; exit 1 ;;
  esac
  sleep 5
done

ping() {
  jq -cn --arg r "$1" --arg s "$STUDENT_ID" --arg n "$2" \
    '{v: 1, type: "ping", requestId: $r, studentId: $s, payload: {note: $n}}'
}

step "Chat (REST)"
curl -fsS "${auth[@]}" -H 'content-type: application/json' "$API/api/agents/$AGENT_ID/chat" \
  -d "$(jq -n --arg m "$(ping "chat-$(date +%s)" 'via chat api')" '{message: $m}')" | jq .

step "Webhook"
wh=$(curl -fsS "${auth[@]}" "$API/api/webhooks/$AGENT_ID/token")
echo "$wh" | jq 'del(.token) | del(.url)'
WH_TOKEN=$(echo "$wh" | jq -r '.token')
# Send the envelope itself as the JSON body, the way the backend scheduler will.
curl -sS -w '\nHTTP %{http_code}\n' -H "X-Maritime-Webhook-Token: $WH_TOKEN" -H 'content-type: application/json' \
  "$API/api/webhooks/$AGENT_ID" -d "$(ping "webhook-$(date +%s)" 'via webhook')"
echo "Webhooks are delivered in the background; waiting 10 s..."
sleep 10

step "Logs: how did the webhook body arrive?"
maritime logs "$NAME" --json 2>/dev/null | jq -r '(.results // .)[]? | (.message // .msg // tostring)' | grep -E '\[chat|\[event|helm-agent' | tail -20 \
  || maritime logs "$NAME" | tail -40

step "Triggers (should include the /schedules entries once Maritime polls them)"
maritime triggers list "$NAME" || true

step "Done. Record findings in docs/maritime-notes.md"
