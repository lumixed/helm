# Helm

**One private AI agent per person, built on [Maritime](https://maritime.sh).** Helm is a personal
assistant: it reads the documents, email, calendar and chats you give it, keeps one list of
everything you owe and when, writes you a brief every morning, reminds you on time, and handles the
busywork with your OK. Because an assistant that reads your mail should live in its own locked room,
every person gets their **own agent in its own Maritime VM**, never a shared server holding everyone's inbox.

- **Live:** <https://helmedaddy.buzz> (also <https://helm-pi-fawn.vercel.app>)
- **Built at HackCamp 2026** by Jefferson Abraham and Jasmine Kwan, for **Best Agent on Maritime**.
- Maritime details and verified behaviour: [`docs/maritime-notes.md`](docs/maritime-notes.md).
  Specs: [`docs/PRD.md`](docs/PRD.md), [`docs/PRD-v2-maritime.md`](docs/PRD-v2-maritime.md),
  [`docs/PRD-v3-pivot.md`](docs/PRD-v3-pivot.md).

## What it does

|                        |                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reads**              | Syllabi, leases, bills and invites (opened in a throwaway Maritime sandbox); Gmail (read-only, token only in the agent); Canvas calendar feeds; shared messages; WhatsApp, Instagram and Slack (beta) on the person's own private Maritime desktop, where they log in themselves and Helm only reads. |
| **Plans**              | One ranked list (nothing counts until you confirm it), a morning brief, time blocks around Google Calendar, reminders, an evening check-in and a weekly review on `/week`.                                                                                                                            |
| **Talks**              | Ask chat and Telegram: questions, "dentist Friday 3pm" (added to the plan), "remind me to pay rent on the 1st", "remember I don't work Sundays" (kept only on the agent's disk), email drafts. Each answer shows which model wrote it.                                                                |
| **Acts, with your OK** | Scheduled hand-ins with a hold window and receipts (to a demo portal), Gmail drafts and follow-up nudges for mail nobody answered. Helm never sends on its own.                                                                                                                                       |
| **Everywhere**         | Web, installable PWA, an iPhone/Android app (Expo, `apps/mobile`), Telegram and push.                                                                                                                                                                                                                 |

## Maritime features in use

Each has live evidence on the app's **Under the hood** page (`/maritime`), read from Maritime itself.

| Feature                          | What Helm uses it for                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| End users                        | One agent per person, created at sign-up                                                               |
| Custom container                 | Our own agent image (`helm-image-vN` releases, upgraded with `/data` kept)                             |
| Persistent `/data`               | Memory, notes the person asked it to remember, event outbox, settings, documents                       |
| Sleep and wake                   | Idle agents sleep; they restore from a snapshot in seconds                                             |
| Platform cron (`GET /schedules`) | Morning brief, safety-net heartbeat, routines, and **one cron per reminder**, in the person's timezone |
| Webhooks                         | New documents, email, hand-ins and "send my brief now" wake the agent                                  |
| Encrypted secrets                | The agent's token and keys (Gemini, Gmail, Canvas, portal login) live only in its VM                   |
| Files API                        | Settings written to the agent's disk (brief time, reminders, routines)                                 |
| Scoped tokens                    | Ask uses a 15-minute chat-only token straight to the person's agent                                    |
| Spend and wake caps              | Per-person limits, shown in Settings                                                                   |
| Lifecycle webhooks               | Wake, sleep and error events on the timeline                                                           |
| Network allowlist                | The agent can reach only approved hosts; a red-team demo shows a blocked request                       |
| Sandboxes                        | Untrusted documents are parsed in a throwaway machine, never in the agent                              |
| Linux desktop + takeover         | Private browser for WhatsApp, Instagram and Slack; the person logs in through a takeover link          |
| Maritime LLM                     | The agent's own capped AI (opt-in with `MARITIME_LLM=on`), with Gemini as fallback                     |

## Honest limits

- Hand-ins go to a clearly labelled **demo portal**, not a real course site.
- **Slack** and **"waiting on"** follow-ups are built and tested in code, not yet against a real Slack workspace or mailbox.
- The iPhone app runs in Expo Go; there is no App Store build yet. Server push needs a development build.
- Maritime LLM is opt-in: on an account without AI credits Maritime skips scheduled wakes, so Gemini is the default.

## Screenshots

| Today (phone)                                                                                   | Review what the agent found                                                                                        | Hand in, with your OK                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| ![Today on a phone: the morning brief with three focus items](docs/screenshots/today-phone.png) | ![Review screen: extracted deadlines with the syllabus quote and assumptions](docs/screenshots/review-desktop.png) | ![A scheduled hand-in with Hold, Submit now and Cancel](docs/screenshots/hand-in-phone.png) |

**Under the hood:** live evidence for every Maritime feature Helm uses, from the person's own agent.

![Under the hood: scorecard of Maritime features with live evidence](docs/screenshots/under-the-hood-desktop.png)

**Agent timeline:** a red-team simulation blocked by the network allowlist, confirmed by Maritime's own test.

![Timeline showing a blocked outbound request and Maritime network tests](docs/screenshots/timeline-desktop.png)

## Layout

```
apps/web          Next.js backend + app (API routes, scheduler, demo portal at /mock-portal)
apps/mobile       Expo app for iPhone and Android (native shell, local notifications)
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
scripts/g1-spike.sh helm-g1
```

## Ship a new agent version

```bash
export MARITIME_API_KEY=mk_...
scripts/upgrade-agents.sh v0-18                  # add MARITIME_LLM=on to switch agents to Maritime LLM
```

This builds the agent on Maritime as `helm-image-v0-18` and moves every student's agent onto it, keeping their `/data`. With `MARITIME_AGENT_IMAGE=auto` on the backend, new sign-ups use it automatically.

## Run everything locally

```bash
pnpm --filter @helm/agent build
PORT=8787 HELM_DATA_DIR=/tmp/helm-agent GEMINI_API_KEY=... node agent/.deploy/server.mjs
# in apps/web/.env.local:
#   HELM_LOCAL_AGENT_URL=http://127.0.0.1:8787
#   HELM_LOCAL_AGENT_DATA_DIR=/tmp/helm-agent
#   APP_BASE_URL=http://127.0.0.1:3000   AUTH_SECRET=...   DEMO_MODE=true
pnpm dev
```

The app talks to the local agent instead of Maritime, using the same messages. Without `DATABASE_URL` it uses an in-memory database.

## Guardrails

- Helm **never writes, edits or improves** a student's assignment. It only handles logistics.
- It submits only the student's own finished file, only after they tap **Schedule**, with a hold notice before it acts.
- Email, syllabus and portal text is **data, never instructions**. It can only produce validated, structured change events.
- Each student's raw files stay on their own agent's disk. The backend keeps structured results and hashes.
- The LMS in the demo is a clearly labelled fake portal. No real credentials are collected.
