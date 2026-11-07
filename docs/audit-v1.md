# Audit of the v1 build against PRD v2

Date: 2026-11-07, ~22:30 PT. Commit audited: `9053d1a` on `main`.
Method: read the code, ran `pnpm check`, checked the live app (`helm-pi-fawn.vercel.app`) and the live Maritime account, and re-read the Maritime docs pages that v2 depends on.

**Checks:** format, lint and typecheck pass. 83 tests pass (shared 30, agent 29, web 24). GitHub Actions status was not checked from here (the GitHub CLI in this sandbox is not logged in).

---

## A. Feature status (PRD v1 IDs)

| ID                        | Status                                 | Where                                                                                    | How to verify                                                                                                                                                                                            |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Auth + profile         | **done** (email only, no verification) | `apps/web/src/lib/session.ts`, `app/signin`, `app/setup`, `api/me`                       | Sign in on a phone; settings persist                                                                                                                                                                     |
| M2 Per-student agent      | **partial**                            | `lib/provisioning.ts`, `lib/maritime.ts`                                                 | Create, idempotency and 2-students-2-agents verified live. **Delete fails**: the API key lacks `manage` (403)                                                                                            |
| M3 Intake + review        | **done**                               | agent `tools/extract.ts`, `tools/read-document.ts`; web `api/onboarding/*`, `app/review` | Gate G2 passed on production: PDF → 7/7 deadlines in 25 s. Eval 15/15                                                                                                                                    |
| M4 Courses + assignments  | **partial**                            | `api/assignments/*`, `app/review`                                                        | Editing works on the review screen only. No list/calendar view, no status or progress UI                                                                                                                 |
| M5 Morning brief          | **partial**                            | `packages/shared/ranking.ts`, `app/today`, agent `server.ts` (`/schedules`)              | Ranking is done and tested. The brief cron is registered on Maritime. **The agent's `brief.generate` handler is a stub**: no brief is written, stored or sent. No "Send brief now" button, no Telegram   |
| M6 Inbox change detection | **missing**                            | —                                                                                        | Only the message type and the "text is data" parser exist                                                                                                                                                |
| M7 Submission pipeline    | **missing**                            | DB tables only (`submissions`, `receipts`)                                               | —                                                                                                                                                                                                        |
| M8 Agent timeline         | **partial**                            | `agent_events` table, `api/agent/events`, `api/dev/events` (JSON)                        | Events are stored for real (wake, pong, intake parsed, errors). No timeline screen                                                                                                                       |
| M9 Demo mode              | **partial**                            | `DEMO_MODE` flag, `api/dev/events`                                                       | No demo panel, no simulate-email, no seed/reset                                                                                                                                                          |
| S1–S3, S5, S7             | missing                                | —                                                                                        | —                                                                                                                                                                                                        |
| S4 spoken brief, S6 Auth0 | dropped by v2                          | —                                                                                        | —                                                                                                                                                                                                        |
| S8 Policy caps            | **partial**                            | `setPolicy` in `lib/provisioning.ts`                                                     | Policy is stored (`llm_spend_cap_cents_per_month: 300, wakes_per_hour: 120, idle_sleep_seconds: 300`), but GET returns `appliedToAgents: 0`, and the LLM cap does not apply to our Gemini calls (see D2) |

## B. Maritime usage inventory

**Provisioning:** REST, not the SDK: `PUT /api/v1/end-users/{id}`, then `POST /api/v1/end-users/{id}/agents` with `framework: "custom"`, `imageName`, `idleTtlSeconds` and `initialEnvVars`. (SDK 0.11 can't send `framework`.) **Idempotent**: one `agents` row per user, Maritime returns the same agent on repeat calls, and a lost-token case is flagged.

**Packaging and deploy:** custom container (`agent/` → esbuild bundle → `agent/.deploy/{Dockerfile, server.mjs}`), built on Maritime from a ZIP upload as a release agent `helm-image-vN`. Students start from that image digest (~1 min), and `scripts/upgrade-agents.sh` moves existing agents to a new image (`maritime deploy --source docker`, `/data` kept). **Running on Maritime now:** yes, 2 student agents on `helm-image-v0-4`.

**How work reaches the agent:** webhooks (`POST /api/webhooks/{id}` with the invoke token) for `intake.parse`. Schedules come from the agent's `GET /schedules`, which Maritime turns into platform cron triggers (`source: byo_sync`; seen in `maritime triggers list`: brief `30 7 * * *` in `America/Vancouver`, heartbeat every 15 min). **No important in-process timers** (only a reply-budget race and retry backoff).

**Secrets:** no `mk_` key in any agent VM or in git history (scanned). Agents get `HELM_AGENT_TOKEN` and `GEMINI_API_KEY` as encrypted env at creation. The backend keeps only a SHA-256 hash of the agent token.

| v2 feature                      | Status                                    | Notes                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-0.1 End users                | **real**                                  | Delete blocked by key scope (`manage`)                                                                                                                                                                                      |
| WP-0.2 `/data` + sleep/wake     | **real**                                  | Dedupe keys, event outbox, settings file and syllabi live on `/data`. Survived a redeploy (verified); sleep/wake survival seen in passing, not formally tested                                                              |
| WP-0.3 Cron trigger             | **real, but the brief handler is a stub** | Recomputed when brief time or timezone changes (settings file → `/schedules` → Maritime polls). How fast the change propagates is **unverified**                                                                            |
| WP-0.4 Webhook invoke           | **real** for syllabi                      | No queue for the 30/min limit (a 429 is not retried). Inbox and submission jobs not built                                                                                                                                   |
| WP-0.5 Encrypted env            | **real**                                  | Portal credentials don't exist yet. Secrets can't be rotated without the `secrets` scope                                                                                                                                    |
| WP-0.6 Files API                | **real** for syllabi                      | `files/upload` with `dest_dir`. Backend cap is 10 MB. Homework not built                                                                                                                                                    |
| WP-1 Lifecycle webhooks         | **absent**                                | 0 subscriptions. Docs: 14 events incl. `agent.woken`, `agent.sleeping`, `agent.llm_limit_reached`, `end_user.*`; HMAC `X-Maritime-Signature`; retries over ~33 h                                                            |
| WP-2 `eu_` tokens / direct chat | **absent**                                | There is no chat at all, so nothing is proxied either                                                                                                                                                                       |
| WP-3 Policy panel               | **partial**                               | Policy set at provisioning. No memory/CPU/disk values, no panel, no `llm_limit_reached` handling                                                                                                                            |
| WP-4 Scorecard                  | **absent**                                | —                                                                                                                                                                                                                           |
| WP-5 Egress allowlist           | **absent**                                | Agent network is `internet: all`. The docs are clear and complete: `PUT /api/v1/network/workloads/agent/{id}` with `internet.mode: "list"`, `test` endpoint, and **`GET /api/v1/network/activity`** (a real connection log) |
| WP-6 Ephemeral sandbox          | **absent**                                | Files are parsed inside the agent VM (unpdf/mammoth). Our key can list sandboxes (200); creating one is untested                                                                                                            |
| WP-7 Desktop + takeover         | **absent**                                | Our key can list computers (200). The computer-use loop needs a vision model that can drive screens; the Gemini model list includes `gemini-2.5-computer-use-preview-10-2025`                                               |
| P4 Maritime LLM proxy           | **absent**                                | See D2: it is what makes the spend cap real                                                                                                                                                                                 |

## C. Golden path check (PRD v1 section 15)

1. Sign in → agent provisioned: ✅ (live, ~70 s to ready)
2. Upload syllabus → review → confirm: ✅ (live, 25 s)
3. **"Send brief now" → Today + Telegram: ❌ first break.** The Today screen shows the ranked focus list, but no brief is generated, stored or sent, and there is no Telegram.
4. Homework upload / checks / schedule / hold / submit / receipt: ❌ (M7 missing)
5. Simulated professor email → replan: ❌ (M6 missing)
6. Timeline: ❌ no screen (data exists)

Against the v2 path (section 8): step 0:50 (sandbox parse) and everything after 1:20 are not built yet.

## D. Risks and conflicts with v2

1. **The API key lacks `manage`** (and `secrets`). That blocks deleting students (WP-0.1 acceptance criteria), minting narrow keys (`keys.create` needs `manage`), rotating agent secrets, and possibly creating sandboxes and computers. **Fix: put a full-access key on the backend** (Vercel `MARITIME_API_KEY`) and in this session's secret.
2. **The spend cap is not real for our LLM calls.** Maritime's cap applies only to its LLM proxy (`mllm_` per-agent tokens). Our agents call Gemini directly with one shared key copied into every VM. Switching extraction to the Maritime proxy is cheap (our client already speaks the OpenAI format; change the base URL, model and key), would make WP-3 real, remove the shared key from VMs, and simplify WP-5 (the Maritime platform is always reachable). Needs prepaid **AI credits** on the account and a quality re-check (proxy models are OpenAI's, e.g. `gpt-5.4`/`gpt-5-mini`).
3. **Raw syllabi stay on the agent's `/data/inbox/` indefinitely.** That is fine under v1 (raw files stay in the VM). Under v2 WP-6 the parse should happen in a throwaway sandbox; decide whether `/data` keeps a copy.
4. **Sandbox file transfer:** the documented ways are the CLI `sandbox cp` and data-plane `/commands`. Proposed design that keeps the full key out of the VM: the backend creates the sandbox and hands the agent only that sandbox's `dataPlaneUrl` + per-sandbox `secret`; the agent pushes the file (base64 over `/commands`, size limit to test) and runs the parser there.
5. **Desktop driver is the riskiest item:** it needs a computer-use model loop, the mock portal (not built yet) on a public URL, takeover UX and cost control. Gate it with the 90-minute spike, and do it after M7's HTTP driver exists.
6. **No webhook queue** for the 30/min limit; a burst returns 429 and the backend gives up.
7. **Sign-in has no verification** (anyone can sign in as any email). OK for a demo with fictional data; say so in the README.
8. **Local-dev mode writes the agent token into the settings file.** Guarded to never run on Vercel; production uses encrypted env.
9. **Schedules are published by the agent (`GET /schedules`), not created by the backend via CLI/API.** Maritime documents this for custom containers and registers them as real platform cron triggers, so it meets "not in-process". The scorecard should say "platform cron via schedule sync".
10. **Test leftovers:** `helm-g1`, `user_spike1`, `user_spike2` are stopped; deleting them needs `manage`. Release agents `helm-image-v0-3`/`v0-4` are kept on purpose.
11. **`helm-build` skill (team Git rules) is not in the repo.** Commits use `type: subject` + `Refs:` + `Claude-Session:` lines, no co-author lines, authored as `lumixed`.
12. **Telegram is not started.** v2 still uses it for takeover and hold links; P4 suggests Maritime's own Telegram channel instead.

## E. Cost and ordering estimate

| Item                                                     | Cost given the code today | Why                                                                            |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Full-access key (D1)                                     | 5 min, you                | Dashboard                                                                      |
| M5 brief handler + "Send brief now" + timeline screen    | 2–3 h                     | Ranking, cron and events already exist                                         |
| WP-1 lifecycle webhooks → timeline                       | 1–1.5 h                   | Documented, signed, simple receiver                                            |
| WP-5 egress allowlist + red-team button + blocked events | 1.5–2 h                   | One API call per agent at provisioning; activity log gives real blocked events |
| WP-3 policy panel (+ D2 Maritime LLM switch)             | 1–2 h                     | Policy is already set; switch is a base-URL change plus eval                   |
| WP-4 scorecard                                           | 1.5–2 h                   | Reads data the items above produce                                             |
| WP-2 `eu_` tokens + chat                                 | 2–3 h                     | Chat (S2) doesn't exist yet                                                    |
| M6 inbox change detection                                | 3–4 h                     | Classifier, matching, provenance, UI                                           |
| M7 submission pipeline (HTTP driver) + mock portal       | 5–7 h                     | Biggest v1 gap; needed before WP-7                                             |
| WP-6 sandbox parsing                                     | 2–3 h + 45 min spike      | Transfer path unverified                                                       |
| WP-7 desktop + takeover                                  | 90 min spike + 3–5 h      | Highest risk                                                                   |
