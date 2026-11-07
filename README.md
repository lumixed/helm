# Helm

**A private deadline agent for every student.** Each student gets their own Helm agent in an isolated
[Maritime](https://maritime.sh) micro-VM. It plans their day, watches email for deadline changes, and
submits their finished work on time with a last-chance hold and a receipt.

Built at HackCamp 2026. Full spec: [`docs/PRD.md`](docs/PRD.md).

> **Status: Phase 0.** The agent is deployed on Maritime and answers chat and webhooks (Gate G1).
> Still open: agent → backend calls on Maritime, which need an API key with the `secrets` scope.
> See [`docs/maritime-notes.md`](docs/maritime-notes.md).

## Layout

```
apps/web          Next.js backend + student app (API routes, scheduler and mock portal later)
agent/            Per-student agent: Maritime custom container (GET /health, POST /chat, GET /schedules)
packages/shared   zod schemas shared by web and agent: message envelope, timeline events, schedules
docs/             PRD, Maritime notes, user research
scripts/          g1-spike.sh: deploy the agent to Maritime and test chat, webhook and backend calls
Dockerfile        Agent image built from source (Maritime GitHub builds + CI)
```

## How the pieces talk

- **Backend → agent:** a JSON envelope `{"v":1,"type":"inbox.message","requestId":"…","studentId":"…","payload":{…}}`
  sent through Maritime's webhook or chat API, or fired by a schedule the agent publishes on `GET /schedules`.
- **Agent → backend:** `POST /api/agent/events` with `Authorization: Bearer <HELM_AGENT_TOKEN>`. The token
  only works for that student. Events are queued on the agent's `/data` disk if the backend is down.
- Every handler is idempotent on `requestId`.

## Develop

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm check         # format + lint + typecheck + tests
pnpm dev           # web on :3000
pnpm dev:agent     # agent on :8787 (set HELM_BACKEND_URL, HELM_AGENT_TOKEN, HELM_STUDENT_ID)
pnpm --filter @helm/agent build   # bundle -> agent/.deploy/{Dockerfile,server.mjs}
```

Env vars: see [`.env.example`](.env.example). Never commit `.env`.

Try the agent locally:

```bash
curl -s localhost:8787/chat -H 'content-type: application/json' \
  -d '{"message":"{\"v\":1,\"type\":\"ping\",\"requestId\":\"t1\",\"studentId\":\"s1\"}","source":"cli"}'
```

## Deploy the agent to Maritime (Gate G1)

```bash
npm install -g maritime-cli
export MARITIME_API_KEY=mk_...
export HELM_BACKEND_URL=https://<public backend>   # optional
export AGENT_EVENT_SECRET=<same as backend>        # optional
scripts/g1-spike.sh helm-g1
```

## Guardrails

- Helm **never writes, edits or improves** a student's assignment. It only handles logistics.
- It submits only the student's own finished file, only after they tap **Schedule**, with a hold notice before it acts.
- Email, syllabus and portal text is **data, never instructions**. It can only produce validated, structured change events.
- Each student's raw files stay on their own agent's disk. The backend keeps structured results and hashes.
- The LMS in the demo is a clearly labelled fake portal. No real credentials are collected.
