# Maritime notes

Facts read from the live docs on **2026-11-07** (`maritime.sh/docs/*`, CLI `maritime-cli` 2.2.0, `maritime guide --json`).
Re-check before relying on an exact name. Anything marked **UNVERIFIED** has not been run against the real platform yet.

## Custom container contract (verified in docs)

Source: `/docs/frameworks/custom`

- Bind `0.0.0.0:$PORT`. Maritime injects `PORT` (currently 18789) and forwards VM port 8080 to it. **Never bind 8080 or set PORT yourself.**
- `GET /health` → any 2xx, fast, no side effects.
- `POST /chat` body: `{"message": "...", "source": "front_door" | "cli" | "telegram" | "scheduled" | ...}` (plus optional `conversation_id`).
  Reply **within 30 s** with plain text or `{"response": "..."}` (accepted keys, in priority order: `response`, `reply`, `message`, `text`, `output`). If the reply is lost, Maritime does **not** resend the turn.
- Install `ca-certificates` in slim images.
- Persist only to `/data`. `HOME=/data`. Root disk is ~2 GB; `/tmp` is in RAM.
- The process is **snapshotted and resumed** on sleep/wake, not restarted. Don't trust cached wall-clock time; reopen long-lived connections lazily.
- `/etc/hosts` is empty: write `127.0.0.1 localhost` at startup (the agent does this).
- **No shell-string CMD.** Use exec form (`CMD ["node", "/app/server.mjs"]`).
- No LLM key by default. `useMaritimeLlm: true` gives `OPENAI_API_KEY`/`OPENAI_BASE_URL` for Maritime's proxy. We bring our own `GEMINI_API_KEY` as a secret env var instead.

## Scheduling

Sources: `/docs/triggers`, `/docs/sdk/agents`

- Timers inside a sleeping VM never fire. The platform holds schedules.
- A custom container can serve **`GET /schedules`**: `[{id, cron, tz, prompt?, enabled}]`. Maritime polls it while the agent is awake and registers real wake triggers. An entry with `prompt` is delivered to `POST /chat` with `source: "scheduled"` at the occurrence.
- **`tz` is supported per entry.** So the morning brief cron is written in the student's local time (`30 7 * * *`, `tz: America/Vancouver`). This replaces the PRD's "compute cron in UTC" plan and removes DST math.
- **Differs from PRD Appendix A:** the SDK's `pushSchedules` accepts **one-off** entries with `nextRunAt` (ISO time). The PRD says one-off triggers are not documented. Plan unchanged: exact-time submissions stay owned by the backend scheduler, and a `nextRunAt` entry can be added later as a second safety net.
- CLI alternative: `maritime triggers create <agent> --type cron --cron "<5-field>" --prompt "<text>"`.
- A scheduled prompt is a fixed string, so it carries the same `requestId` every day. The agent appends the fire minute (`cron:brief@2026-11-08T15:30`) so dedupe doesn't swallow the next brief.

## Webhooks (inbound to the agent)

Source: `/docs/triggers`, `/docs/api#webhooks`

- `POST https://api.maritime.sh/api/webhooks/{agent_id}` with header `X-Maritime-Webhook-Token` (or `?token=`). JSON body is delivered to the agent "as a message".
- The POST is **accepted immediately and delivered in the background**. The caller does not get the agent's reply, so results must come back through `POST /api/agent/events`.
- Token: `GET /api/webhooks/{agent_id}/token` (owner). Rotate: `POST …/token/rotate` (needs `manage` scope).
- Rate limit: 30/min per caller IP per agent, **shared with the agent's message budget**. A burst returns `429` with `Retry-After` and is **not queued** by Maritime, so the backend must queue and retry.
- Calls without a token are accepted for now but will be refused once enforcement turns on. Always send it.
- **UNVERIFIED:** the exact shape of `message` for a webhook delivery (raw JSON string, wrapped, or prefixed text). `parseInbound` in `packages/shared` accepts all of these. `scripts/g1-spike.sh` turns on `HELM_DEBUG_INBOUND=1` to log it. Record the answer here.

## Provisioning one agent per student

Sources: `/docs/sdk/end-users`, `/docs/sdk/agents`, `/docs/api`

- SDK package: **`maritime-sdk`** (npm, 0.11.0 on 2026-11-07). Reads `MARITIME_API_KEY`.
- `endUsers.upsert(externalId, {displayName, metadata, tags})` and `endUsers.createAgent(externalId, opts)` (idempotent, same options as `agents.provision`).
  REST: `PUT /api/v1/end-users/{external_id}`, `POST /api/v1/end-users/{external_id}/agents`.
- `externalId`: 1–128 chars of letters, digits, `_ @ . : + -`.
- `agents.create` / raw `POST /api/agents` are **not** idempotent (409 on name clash). Use `provision` / `createAgent`.
- Per-agent secrets: `agents.setEnv(id, key, value, {secret: true})` then `agents.reloadEnv(id)`.
- Policy: `endUsers.setPolicy` with `llmSpendCapCentsPerMonth`, `wakesPerHour`, `idleSleepSeconds`, `memMb`, `vcpus`, `diskGb`, `computeMinutesCap`.
- Browser tokens: `endUsers.mintToken(externalId, {scopes: ['chat','files'], ttlSeconds})`, 30–3600 s.
- Header `X-Maritime-End-User: <externalId>` on any agent call scopes it to that end user (other agents answer 404).
- **UNVERIFIED:** which `createAgent` option points at our custom image. CLI `agents create` takes `--framework custom` with `--upload-key <s3Key>` (from `agents upload-source`), `--github-repo`, or `--image` (public registry only). The SDK/REST field names for these still need a check (likely `framework`, `uploadKey`/`imageName`).

## Deploying our image

Sources: `/docs/builds`, `/docs/images`, CLI help

- **ZIP/dir upload works without GitHub:** `maritime agents upload-source agent/.deploy` returns `s3Key`. Then `maritime agents create --framework custom --upload-key <s3Key>`, or do both at once with `--from-dir agent/.deploy`.
- Repo builds: `Dockerfile` must be at the repo root, named exactly `Dockerfile`. No build args or targets. Private repos need the Maritime GitHub App. `.dockerignore` is honored for repos, **not** for ZIPs.
- Pre-built images: **public registries only**.
- A build that prints nothing for 5 minutes is killed. A typical build takes 1–3 minutes.
- Our layout: `agent/.deploy/` = `Dockerfile` + single bundled `server.mjs` (no npm install during the Maritime build). The root `Dockerfile` builds the same image from source for GitHub deploys and CI.

## Files API

- `POST /api/agents/{id}/files/upload` multipart `file`. With `dest_dir` it lands in that volume directory; **without it, it is delivered as a chat attachment** (the agent is notified in its current conversation). Use `dest_dir` for syllabi and homework.
- Take the volume root from `files/list` (`root`), don't hardcode `/data`.
- 100 MB per file. Any file call wakes the agent.

## Account limits (from `GET /api/v1/account/limits`, 2026-11-07)

- `maxAwakeMachines: 5` on Starter/trial. Waking a 6th returns `429 awake_limit_reached` (retry 15 s). Fine for a 2-student demo; the scheduler must handle 429.
- `agentCreatesPerMinute: 30`.
- **Our account currently has `plan: none`, `blockedReason: card_required`.** Someone on the team must start the free trial (Billing page, card required, $20 usage cap) before any agent can be created.

## Open items

- [ ] Start the Maritime free trial (blocks everything below).
- [ ] Run `scripts/g1-spike.sh`. Record: build time, boot status values, webhook `message` shape, whether `/schedules` entries appear in `maritime triggers list`, and wake latency.
- [ ] Confirm the SDK/REST field for a custom image or upload key in `endUsers.createAgent`.
- [ ] Confirm whether a ZIP source can be redeployed onto an existing agent (needed so every student agent gets new versions). Fallback: GitHub source (needs the Maritime GitHub App on `lumixed/helm`) or a public GHCR image.
- [ ] Which lifecycle webhooks exist (`agent.sleeping` is shown in the end-users docs). Use them for the timeline if available.
- [ ] Does background work after a `/chat` reply keep the VM awake, or can it be frozen mid-task? Mitigation for now: set `idleSleepSeconds` ≥ 120 in the end-user policy.
