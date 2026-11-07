# Helm — PRD v2: Maritime-first update

**Applies on top of:** `PRD.md` (v1) and the code already built from it.
**Precedence:** where this document and `PRD.md` conflict, **this document wins**. Everything in `PRD.md` that is not mentioned here stays as is.
**Event:** HackCamp 2026 (Nov 7–8, 2026, 24 hours). Written Saturday afternoon; the build is already underway.
**Single prize target:** Sponsor track **"Best Agent on Maritime"** (opt in, agent deployed on Maritime, short demo in the Devpost submission). Overall, Community Impact and nwChoice are considered automatically and need no extra work beyond a good video and README.

---

## 0. How to use this document

1. **Do not start building features yet. First do the audit (section 2).** The team has already built things with Claude Code from PRD v1, and this PRD assumes nothing about what exists.
2. Then apply the work packages in section 5 in priority order, honoring the gates in section 9.
3. Every Maritime detail below was read from Maritime's public docs on 2026-11-07 (Appendix A). **Verify before depending on any exact name, flag, scope or payload**, and record what you learn in `docs/maritime-notes.md`. Never invent endpoints. Where docs are silent, run a short spike (timeboxes are given).
4. The scorecard in section 6 must be **truthful**: a feature appears as "active" only if it is really running. Never claim a feature the demo cannot show.
5. Follow the Git rules in the `helm-build` skill (section 12): team commit format, commit and push after every meaningful change, no Claude co-author lines.

---

## 1. What changed and why

### New strategy
The goal is now to **win "Best Agent on Maritime"** by using Maritime's platform deeply, in ways that make Helm better, not as a checklist. All the effort that previously went to other sponsor prizes is redirected to Maritime.

### Positioning (new)
> **Helm is a private AI agent for every student, isolated at every layer, built on Maritime.**
> *You can't hand an agent your email and your logins unless you can trust it. Helm's agent runs in its own VM, opens untrusted files in throwaway sandboxes, can only reach an allowlist of hosts, is capped on spend and wakes, and hands control back to you for logins and 2FA.*

The product (morning brief, change detection, safe scheduled submission) is unchanged. The **story** is now the isolation layers, and the **demo** proves them live.

### Priority changes vs PRD v1
| Item | v1 | v2 |
|---|---|---|
| Other sponsor prizes (Gemini MLH, Auth0, n8n, ElevenLabs, Lovable, Databricks, Tiger Data, etc.) | Optional stacking | **Dropped as goals.** Keep whatever LLM is already integrated if it works; do not spend time on prize-specific integrations. |
| S4 spoken brief (ElevenLabs), S6 Auth0 | Should | **Removed** |
| Best Design / Figma | Optional | **Dropped** (keep the UI clean and accessible, no Figma needed) |
| Maritime feature depth | Core features only | **Primary objective** (section 5) |
| Submission path | HTTP form POST to mock portal | **Desktop (real browser) driver** with HTTP as fallback |
| Demo script | PRD v1 section 15 | **Replaced** by section 8 |
| Build plan and gates | PRD v1 section 17 | **Replaced** by section 9 |

### Audience
Stays **students** (best problem-and-research story). "Personal assistant for everyone" goes on the roadmap slide: the engine (sources → priority → brief → approved actions) is general.

---

## 2. Step 1: Audit the existing build (do this first, ~30 min)

Produce `docs/audit-v1.md`, then summarize in ≤15 lines to the user and propose an ordered task list. Do **not** rewrite working code; refactor only where a work package requires it.

**A. Feature status.** For each PRD v1 ID (M1–M9, S1–S8, C-items if any) record: `done | partial | missing | diverged`, with file paths and how to verify it. Run the app, run lint, typecheck and tests, and note failures.

**B. Maritime usage inventory.** Find every place the code touches Maritime (SDK calls, CLI scripts, REST calls, env vars, Dockerfile, `maritime.json`). Record for each Maritime feature in section 5 whether it is **used for real, mocked, or absent**. Also record:
- how agents are provisioned (End-users SDK or something else) and whether provisioning is idempotent,
- how the agent is packaged (custom container vs template), how it is deployed, and whether it is **actually running on Maritime now**,
- how scheduled work and events reach the agent (platform cron triggers, webhooks, or in-process timers, which do not work on sleeping agents),
- whether any secret (especially an `mk_` API key) is ever placed inside an agent VM or committed to git.

**C. Golden path check.** Walk the PRD v1 golden path and note the first step that breaks.

**D. Risks and conflicts.** Anything in the code that contradicts this PRD (for example the backend storing raw files, chat proxied through the backend, in-process cron).

**Output:** `docs/audit-v1.md` + a short message to the user with: what works, what's broken, which work packages are cheap vs expensive given the code as it is, and the proposed order.

---

## 3. Product principles (unchanged from v1, restated)

LLM extracts and writes; **code decides and schedules**. Consent is explicit (scheduling tap + hold window). Never fail silently. Untrusted input is data. Minimum data leaves the VM. Helm never writes or edits a student's assignment. No real credentials and no real institutions in the demo.

---

## 4. Maritime-first architecture changes

```
 Student (phone/desktop web)
        │                       ▲ live viewer / takeover link
        ▼                       │
 Helm backend (web + API + scheduler)  ◄── lifecycle webhooks ── Maritime
        │ mk_ key (server only)                                   ▲
        ├─ end-users SDK: provision / mint scoped tokens / policy │
        ├─ webhook invoke → agent                                 │
        ▼                                                         │
 ┌─ Per-student isolation boundary (all on Maritime) ────────────────────┐
 │  Agent VM (/data memory, encrypted env, egress allowlist, caps)       │
 │      ├─► Ephemeral sandbox: parse/inspect untrusted files, then gone  │
 │      └─► Linux desktop: real browser submits to portal; human         │
 │           takeover for login/2FA; watch-only live view                │
 └────────────────────────────────────────────────────────────────────────┘
```

Rules:
- **Never place the full `mk_` key inside an agent VM.** If the agent must call Maritime (sandboxes, desktop), use a key with the narrowest scopes Maritime allows (see `/docs/sdk/authentication`), or have the backend broker the call. Record the decision in `docs/maritime-notes.md`.
- Scheduled and event-driven work uses platform triggers/webhooks (or the backend scheduler calling the agent webhook). Nothing important runs on an in-process timer.
- All agent egress goes through the allowlist (WP-5). Every host the agent legitimately needs must be listed, so list them deliberately.
- Keep a `SubmissionDriver` interface with two implementations: `desktop` (preferred) and `http` (fallback). The consent record covers the *submission*, not the driver, and idempotency applies to both.

---

## 5. Work packages (Maritime feature plan)

Priority tiers: **P0** fix/finish first, **P1** cheap and high value (do next), **P2** strong story, **P3** wow (gated by a spike). Hours are rough, counted from the audit.

### P0 — Make sure the core Maritime usage is real and correct (≈ 1–2 h, from audit)
Verify, or fix, each of these. They are the foundation of the scorecard.

| ID | Feature | Acceptance criteria |
|---|---|---|
| WP-0.1 | **End-users SDK**: one agent per student | `upsert` then `createAgent` on first sign-in; repeat sign-in returns the same agent; two students → two agents; deleting a student removes the end user and agent |
| WP-0.2 | **Persistent `/data` + sleep/wake** | Memory, raw files and queues live under `/data`; after the agent sleeps and wakes, state is intact (test it) |
| WP-0.3 | **Cron trigger** for the morning brief | Created via the platform (CLI or API), not in-process; recomputed when timezone or brief time changes; fires and produces a brief |
| WP-0.4 | **Webhook invoke** for events | Inbox messages and submission jobs reach the agent via the webhook with the invoke token; 30/min limit respected via queueing |
| WP-0.5 | **Encrypted env secrets** | Portal credentials and the agent→backend token are set per agent through env, never logged or committed |
| WP-0.6 | **Files API** | Uploaded syllabi and homework are transferred to the agent's `/data` (100 MB cap respected) |

### P1 — Cheap, high-value additions (≈ 1.5–2.5 h each, or less)

**WP-1 Lifecycle webhooks → real timeline**
- Receive Maritime lifecycle webhooks (`/docs/sdk/webhooks`; includes end-user events and `agent.llm_limit_reached`; verify the full event list and any signature scheme) and write them to `maritime_events` and the timeline.
- Show **wake/sleep with measured wake latency** on the timeline.
- *AC:* A brief trigger shows "agent woke (cron) → brief generated → agent slept" with timestamps; a failing delivery is retried or logged.

**WP-2 Scoped short-lived tokens: browser talks directly to its own agent**
- Backend mints `eu_` tokens via `mintToken` (scopes `chat`, `files`; TTL ≤ 900 s) and the browser calls the agent chat endpoint directly. The backend no longer proxies chat content.
- *AC:* Student chat works with a token that expires; a token for student A cannot reach student B's agent (returns 404); revoking tokens cuts access immediately.

**WP-3 Per-student policy and budget panel**
- Apply `setPolicy` at provisioning: `llm_spend_cap_cents_per_month`, `wakes_per_hour`, `idle_sleep_seconds`, and sensible `mem_mb`, `vcpus`, `disk_gb`. Make sure `wakes_per_hour` does not throttle the demo.
- Handle the `agent.llm_limit_reached` webhook: notify the student and show "paused: budget reached".
- *AC:* Policy visible per student; forcing the cap shows the paused state and a notification.

**WP-4 "Under the hood: Maritime" scorecard page** (see section 6). Cheap, judge-facing, built last but designed now.

### P2 — Strong security story (≈ 2–4 h each)

**WP-5 Network egress allowlist (the prompt-injection answer)**
- Set the agent's network **Internet** mode to the allowlist (`list`) and permit only the hosts it needs: Helm backend, the LLM API host(s) in use, Maritime API (if the agent calls it), the portal host. Enforcement happens on the host, outside the workload.
- Configure via the dashboard Network card, CLI, or `PUT /api/v1/network/workloads/agent/{id}` (verify which supports allowlist mode); verify with `maritime agents network test <agent_id> host:443`.
- **Red-team demo (clearly labeled as a simulation):** with `DEMO_MODE`, a "Red-team" button makes the agent *deliberately attempt* an outbound request to a non-allowlisted host (`attacker.example`) to simulate a compromised agent. Show it blocked and logged. Do not present it as a real attack.
- *AC:* Allowed hosts work; a disallowed host fails and a timeline event "egress blocked" is recorded; the legitimate golden path still works with the allowlist on.

**WP-6 Ephemeral sandbox for untrusted files**
- Parse syllabi, inspect homework (type, size, page/word count, text extraction) and open email attachments **inside a throwaway Maritime sandbox** that is deleted with its disk when done. Docs list analyzing an uploaded file that shouldn't remain on disk as a typical use.
- Flow: create sandbox (`POST /api/sandboxes/ephemeral` or SDK `createEphemeral`, key with `sandboxes` scope; short `idleMinutes`/`timeLimitMinutes`, small size) → move the file in → run parser via SDK `run` or HTTP `POST {dataPlaneUrl}/commands` with `X-Maritime-Token` → return **structured JSON only** → kill the sandbox. Sandboxes are E2B-compatible, so E2B client code can run against Maritime if that is faster.
- **Spike (≤ 45 min):** the docs document file copy only via CLI `maritime sandbox cp`. Test an SDK/HTTP way to move bytes in (for example base64 over `/commands`). If none works, document it and parse in the agent VM as a fallback (state the trade-off).
- *AC:* Each parse produces `sandbox.created → command.run → sandbox.ended` timeline events; no raw file content persists after the sandbox ends; a malformed/hostile file fails safely and produces a student-readable error.

### P3 — The wow feature (spike first, then ≈ 3–5 h)

**WP-7 Desktop submission with live view and human takeover**
- Each student gets a **persistent Linux desktop** (end-user scoped): `POST /api/v1/computers` with `externalUserId`, the TypeScript `client.computers`, or the Maritime MCP server (`get_computer` + `computer` tool). The browser profile and logins persist, and it sleeps after 5 idle minutes and wakes in about a second.
- The desktop driver opens the portal in Chromium, logs in, uploads the file, confirms, and reads the receipt. The model takes screenshots and acts step by step (clicks, typing, scrolling, waiting).
- **Human takeover:** when the portal asks for a login or **2FA code**, the agent calls `request_takeover`, the student gets a link (Telegram and in-app), completes the step, and the agent resumes. Agent actions are refused while the student has control.
- **Live viewer:** create a **watch-only viewer link** (expires) and show "Watch Helm submit" in the app during a submission.
- Pin the MCP URL to the end user so an agent can never reach another student's desktop.
- Keep cost under control: always `close_computer` after a run; desktops are billed per second while awake (about $0.12/h); new accounts get a trial with limited credit; Growth plan allows more concurrent awake machines.
- **Mock portal additions:** optional **2FA gate** (demo toggle) with a "mock authenticator" page showing the one-time code, so the takeover moment is real; session persists afterwards so the next run needs no login.
- **Spike (≤ 90 min, go/no-go):** prove an agent can (1) get the student's desktop, (2) open the public mock portal in Chromium, (3) log in, (4) hit the 2FA gate and produce a takeover link, (5) continue after the human finishes, and (6) produce a viewer link. Determine *which model/harness drives the computer-use loop* (the docs say "your model drives them"), whether the custom container can call the MCP/SDK/REST actions directly, and the per-step latency.
- **Fallback if no-go:** keep the HTTP driver as the main path and show the desktop as a short recorded clip or skip it. Update the scorecard honestly.
- *AC:* Golden path submission via the desktop driver succeeds, produces the same receipt as the HTTP driver, shows a live viewer, supports a takeover for 2FA, and falls back to the HTTP driver (with the same idempotency) on desktop failure before the deadline.

### P4 — Optional extras (only after P1–P3 are stable)
- **Maritime LLM proxy** for agent chat or wording (read `/docs/llm` first; billed from prepaid AI credits; this may reduce reliance on another LLM). Do not rework working extraction to use it.
- **Mock portal as its own Maritime public web agent** (`maritime create <name> --repo <url> --public`, Dockerfile at repo root, listen on `0.0.0.0:$PORT`; public URL wakes it in about a second). Only if splitting the portal out is cheap. Do **not** move the backend scheduler to a web agent that sleeps.
- **Telegram via Maritime's channel** instead of your own bot, only if it simplifies things.

---

## 6. "Under the hood: Maritime" scorecard (judge-facing)

Build a page at `/maritime` (and the same table in README and Devpost). One row per Maritime feature, with **live status** pulled from real data where possible:

| Feature | How Helm uses it | Live evidence on the page |
|---|---|---|
| End-users SDK | One agent per student, provisioned at sign-up | Student external ID, agent ID, status |
| Persistent `/data` | Memory, raw files, queues | Disk used, last write |
| Sleep/wake | Idle between events | Last wake reason and wake latency |
| Cron + webhook triggers | Morning brief, email events, submission jobs | Trigger list, last fire times |
| Encrypted env | Portal credentials, agent token | Count of secrets (never values) |
| Files + chat + scoped tokens | Direct browser↔agent chat | Token TTL, scopes |
| Policy caps | Spend and wake limits | Cap values, usage so far |
| Lifecycle webhooks | Real timeline | Latest events |
| Egress allowlist | Blocks exfiltration | Allowed hosts, blocked attempts |
| Ephemeral sandbox | Throwaway file parsing | Sandbox runs, last created/ended |
| Linux desktop + takeover | Real-browser submission, human 2FA | Desktop state, viewer link, takeover events |

Rules: show **"not active"** for anything not really running. Never fabricate numbers. This page is read-only, uses the logged-in student's data (or the seeded demo student in `DEMO_MODE`), and never shows secrets.

---

## 7. Data model additions

```text
maritime_events(id, user_id, agent_id, kind, payload_json, created_at)        -- lifecycle + our own markers
sandbox_runs(id, user_id, sandbox_id, purpose, status, started_at, ended_at, result_summary)
desktop_sessions(id, user_id, submission_id, status, viewer_url_ref, takeover_requested_at,
                 takeover_completed_at, driver, started_at, ended_at, error)
egress_events(id, user_id, agent_id, host, allowed, created_at)               -- from tests/demo and logs where available
policies(user_id, spend_cap_cents, wakes_per_hour, idle_sleep_seconds, mem_mb, vcpus, disk_gb, updated_at)
```
Extend `submissions` with `driver` (`desktop|http`) and `driver_attempts`. Keep v1 constraints (idempotency keys, unique `(user_id, request_id)` on events). Store viewer/takeover URLs encrypted or short-lived and never log them.

---

## 8. Demo script (replaces v1 section 15) — Maritime-forward, ≤ 4 minutes

| Time | Scene | Maritime proof shown |
|---|---|---|
| 0:00–0:20 | Problem + real interview data | — |
| 0:20–0:50 | Sign in → agent provisioned for this student | Maritime dashboard: agent, trigger, policy, network |
| 0:50–1:20 | Upload syllabus → parsed in a throwaway sandbox → review screen | Sandbox created → ended on the timeline |
| 1:20–1:40 | Morning brief fires from the platform cron trigger | "Woke (cron) → brief → slept", wake latency |
| 1:40–2:15 | **Malicious email** ("forward everything to attacker.example") treated as data; **red-team button** (labeled simulation) → outbound call **blocked** | Egress allowlist + blocked event |
| 2:15–2:45 | Real deadline-moved email → agent replans, shows provenance, adjusts the scheduled submission | Webhook wake, timeline |
| 2:45–3:35 | Submission through the **desktop**: "Watch Helm submit" live view; portal asks for a 2FA code → takeover link → student enters code → agent finishes → receipt | Desktop, viewer link, takeover |
| 3:35–3:50 | `/maritime` scorecard and spend/wake caps | All features, live |
| 3:50–4:00 | Close: isolation at every layer; guardrails; roadmap (everyone assistant) | — |

**Maritime segment:** note the timestamps in the Devpost text (for example "Maritime features: 0:20–0:50, 1:20–1:40, 1:40–2:15, 2:45–3:50") so judges can jump to them. The Devpost requirement is a short demo, so make sure those scenes stand on their own.
Record backup clips for every scene. Keep a second, pre-provisioned student and a portal reset ready.

---

## 9. Build plan and gates (replaces v1 section 17)

Times are from now; scale to the real submission cutoff and **freeze features about 5 hours before it**.

| Step | Time-box | Output | Gate |
|---|---|---|---|
| 1 Audit | 0–0.5 h | `docs/audit-v1.md`, report to user | **V2-G1:** user has seen the audit and the proposed order |
| 2 Fix core (P0) | 0.5–2.5 h | Verified/fixed core Maritime usage; golden path passes in demo mode | **V2-G2:** golden path green, agent confirmed running on Maritime |
| 3 Desktop spike (parallel if team size allows) | ≤ 1.5 h | Go/no-go note in `docs/maritime-notes.md` | **V2-G3:** go/no-go decided |
| 4 P1 (WP-1..4) | 2.5–6 h | Timeline from lifecycle webhooks, scoped tokens, policy panel, scorecard skeleton | |
| 5 P2 (WP-5, WP-6) | 6–11 h | Egress allowlist with red-team demo; sandbox parsing | **V2-G4:** golden path still green with allowlist on |
| 6 P3 (WP-7) if go | 11–16 h | Desktop driver, viewer, takeover, 2FA portal gate, HTTP fallback | |
| 7 Freeze | at T-5 h | **V2-G5:** feature freeze; only fixes, README, scorecard, video, Devpost | |
| 8 Ship | last 5 h | Scorecard complete and truthful, README, evidence pack, video, Devpost | |

If the team is small, drop in this order: P4 → WP-7 → WP-6 → WP-5. Never drop P0 or WP-1/WP-4.

---

## 10. Maritime evidence pack (collect during the build)

- Screenshots: dashboard showing ≥ 2 student agents; trigger list; policy/caps; network settings; logs (`maritime logs <agent> -f`); sandbox run; desktop live view; takeover link used.
- Timeline export showing wake/sleep, sandbox and egress events.
- The `/maritime` scorecard screenshot.
- `docs/maritime-notes.md` summarizing every spike result and every Maritime fact you verified.
- README section "How Helm uses Maritime" mirroring the scorecard and the isolation-layers diagram.
- Devpost: opt in to the Maritime sponsor track, link the demo with timestamps, and state which features are live vs roadmap.

---

## 11. Testing and QA additions

- **Maritime integration tests (against a real dev agent):** idempotent provisioning; token isolation (A cannot reach B); egress allow/deny; sandbox lifecycle and cleanup; webhook receipt; cron trigger fires; wake latency measured.
- **Failure injection:** portal 503; desktop stuck on a screen; takeover never completed (timeout → alert → fallback to HTTP before the deadline); sandbox creation 402/429; policy cap reached.
- **Security checks:** no `mk_` key in agent env or git history; viewer/takeover links never logged; demo endpoints 404 when `DEMO_MODE` is off; prompt-injection fixtures (including the malicious email) pass.
- **Definition of done for the golden path (v2):** the section 8 script succeeds three times in a row without manual fixes, with the allowlist on.

---

## 12. Risks and mitigations (additions)

| Risk | Mitigation |
|---|---|
| Desktop control is slow or flaky | Spike with go/no-go (WP-7); HTTP driver fallback with same idempotency; short recorded clip as a last resort |
| Egress allowlist breaks the agent | List hosts deliberately; test the golden path with it on (V2-G4); keep a quick way to relax during debugging |
| Sandbox file transfer undocumented | 45-minute spike; fallback to parsing in the agent VM and say so honestly |
| Cost overruns (desktops, sandboxes, LLM) | Policy caps; `close_computer` after use; short sandbox timeouts; track trial credit |
| Scorecard claims something that isn't live | Status comes from real data; "not active" is acceptable and honest |
| Docs ambiguity (SDK package names, scopes) | Verify against `/docs/sdk/*`; record in `docs/maritime-notes.md` |
| Scope creep | Gates; drop order in section 9; freeze at T-5 h |
| Rate limits (webhook 30/min; desktop actions 300/min/key) | Per-agent queue; batch desktop actions (`computer_batch` up to 50) |

---

## Appendix A — Maritime facts for v2 (read on 2026-11-07; re-verify)

**Docs:** `https://maritime.sh/docs` — `/docs/ephemeral-sandboxes`, `/docs/computers`, `/docs/networks`, `/docs/web-apps`, `/docs/sdk/end-users`, `/docs/sdk/webhooks`, `/docs/sdk/authentication`, `/docs/triggers`, `/docs/configuration`, `/docs/limits`, `/docs/llm`.

**Ephemeral sandboxes**
- Isolated Linux micro-VMs; IDs start `sbx-`; end with their disk after idle or time limit.
- Create: `POST /api/sandboxes/ephemeral` (key with `sandboxes` scope; `idleMinutes` 1–60 default 5; `timeLimitMinutes` 5–1440 default 1440 (24 h); `size` small/medium/large/xlarge), CLI `maritime sandboxes create --name job-42 --idle 5m --time-limit 30m`, SDK `ephemeral.createEphemeral(...)`.
- Run: SDK connect + `run`; CLI `maritime sandbox exec <id> -- <cmd>`; HTTP `POST {dataPlaneUrl}/commands` with sandbox `secret` in `X-Maritime-Token`; files via CLI `maritime sandbox cp` (SDK/HTTP upload not documented). E2B-compatible via `E2B_DOMAIN` + `E2B_API_KEY`.
- Billing per second while running (small ≈ $0.022/h). Needs a plan or trial (402 otherwise); concurrent-awake limit returns 429.

**Linux desktops (computers)**
- Persistent per-end-user desktops (XFCE, Chromium, LibreOffice). Create via MCP (`get_computer` with an end-user ID, then the `computer` tool), REST `POST /api/v1/computers` with `externalUserId`, or TS SDK `client.computers`. MCP URL can be pinned to one end user.
- Model loop: screenshot (1200×750 default) → one step → act → check; actions: click, type, keys, scroll, drag, wait, zoom; `computer_batch` up to 50 actions, stops on first failure.
- `request_takeover` returns a link for a person to control (logins, 2FA, CAPTCHAs, payments); agent actions are refused until they finish. Viewer links are watch-only or control and expire.
- Sleeps after 5 idle minutes (memory saved ~7 days), wakes in about a second; files and browser profiles persist. File read/write cap 8 MiB (`/data`, `/home/desk`); `run_shell` times out at 30 s.
- ≈ $0.12/h awake (billed per second); asleep ≈ $0.08/GB-month disk; trial up to $20 usage; awake concurrency 5 (Starter/trial), 25 (Growth), 60 (Scale); per-key rate limits 30 creates, 300 actions, 30 viewer links per minute.

**Networks**
- Per workload: **Internet** `all` (default) | `list` (allowed destinations and presets; deny overrides allow) | `none`; **Exit** `shared|fixed|country|through`; **Access** to private resources. Enforced on the host, outside the workload.
- Configure: dashboard (agent → Add-ons → Network card), CLI (for example `maritime agents update <agent_id> --egress fixed --access …`), API `PUT /api/v1/network/workloads/agent/{id}`; test with `maritime agents network test <agent_id> api.example.com:443`. Fixed/country exits need a verified email and a paid plan. The exact way to set `internet=list` through the CLI/API must be verified.
- Docs do not describe private workload-to-workload connections.

**Web agents (optional use)**
- Repo with Dockerfile at root, app listens on `0.0.0.0:$PORT`, public traffic arrives on 8080 and is forwarded; URL `https://<agent-id>.mtm.sh/`; sleeps when idle, wakes in about a second; private by default with end-user share links (`agents.shareLinks.create(agentId, { endUserExternalId })`); `--public` makes it open. Only `/data` persists.

**Already used from v1 (still valid):** End-users SDK (`upsert`, `createAgent`, `mintToken`, `setPolicy`), cron/webhook triggers, `/data`, encrypted env, Files API (100 MB), chat API, webhook invoke (30/min), lifecycle webhooks.

## Appendix B — New environment variables
`MARITIME_SANDBOX_KEY` (narrow `sandboxes` scope, only if the agent calls sandboxes directly; otherwise the backend brokers), `PORTAL_PUBLIC_URL` (must be reachable from the desktop and allowlisted), `PORTAL_2FA_ENABLED`, `DESKTOP_DRIVER_ENABLED`, `EGRESS_ALLOWLIST` (documented list, mirrored in the Maritime network settings), `MARITIME_WEBHOOK_SECRET` (if lifecycle webhooks are signed), `DEMO_MODE` (existing).

## Appendix C — Glossary additions
**Isolation layers:** VM per student, throwaway sandbox for untrusted files, network egress allowlist, scoped short-lived tokens, per-student policy caps, human takeover for logins and 2FA. **Takeover:** the student temporarily controls the agent's desktop to finish a login or 2FA step. **Viewer link:** watch-only live view of the agent's desktop. **Scorecard:** the `/maritime` page showing live evidence of each Maritime feature in use.
