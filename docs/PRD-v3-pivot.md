# Helm — PRD v3: a private assistant for everyone

**Applies on top of:** `PRD.md` (v1) and `PRD-v2-maritime.md` (v2). Where they conflict, **this document wins**.
**Decided:** 2026-11-07 evening, by the team, during HackCamp 2026. Prize target unchanged: **Best Agent on Maritime**.

## 1. The change

Helm is no longer only for students. It is **a private secretary agent for anyone**: it watches your email and the messages you share with it, keeps one list of everything you owe and when, tells you every morning what to do today, and does the routine hand-ins for you with your OK.

> **Pitch:** _You can't hand an assistant your inbox and your logins unless you can trust it. Helm gives everyone their own private agent, isolated at every layer on Maritime: its own VM, a network allowlist, spend caps, and you take over for logins._

Students stay the **first demo persona** (deadlines that move by email are the sharpest version of the problem), but nothing in the product is student-only any more.

## 2. Decisions

| Topic                    | Decision                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audience                 | Everyone. Demo persona: Maya, a student with a part-time job (school, work and bills in one list).                                                                                                                                                     |
| Email                    | **Real Gmail, read-only** (`gmail.readonly`), Google OAuth app in test mode. The refresh token lives only in the user's agent VM as an encrypted Maritime env var; the agent reads mail itself. The backend never stores it.                           |
| WhatsApp, Instagram, SMS | No official API reads a personal account's messages (to verify before the demo; do not claim otherwise). Helm offers **Share / paste to Helm** from any app, and in demo mode **clearly labelled demo messages** per app. Real connectors are roadmap. |
| Phone                    | **Installable web app (PWA)** for the Today screen, and the **morning brief as a Telegram message**. A native app is roadmap.                                                                                                                          |
| Documents                | "Syllabus" becomes **any document with dates**: a syllabus, a lease, a bill, a job offer, an event invite.                                                                                                                                             |
| Assignments              | Shown as **tasks**, grouped by an **area** (a course code, "Work", "Rent", "Health"…). Internal table and field names stay (`assignments`, `course_code`) to avoid churn. New types: bill, appointment, task, event.                                   |
| Submissions              | Generalized to **"Helm does it, with your OK"**: hand in a file or form to a portal with the same consent tap, hold window, retries, receipts and alerts. The demo portal stays.                                                                       |
| Maritime                 | Unchanged and more important: more sensitive data makes each isolation layer matter more. The Gmail and portal secrets in encrypted env, the allowlist (adds the Gmail API host), caps, and the scorecard (WP-3, WP-4) all still apply.                |

## 3. Honesty rules (in addition to v2 section 0)

- Never show or say that Helm reads WhatsApp or Instagram on its own. "Shared with Helm" or "demo message" only.
- Demo messages and the demo portal are labelled as demos on screen.
- Real Gmail in the demo uses a test account with fictional mail.

## 4. Order of work

1. This document.
2. Generalize the model, prompts and wording (tasks, areas, any document).
3. Multi-source inbox: `source` on every message (email, whatsapp, instagram, sms, other), Share/paste UI, demo messages per app.
4. Generalize submissions copy ("Helm does it, with your OK").
5. Installable app (manifest, icons, home-screen install).
6. Telegram: link the chat, morning brief and hold notices as messages.
7. Real Gmail read-only (needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
8. Then v2 items: WP-4 scorecard, WP-3 policy panel.

## 5. Roadmap slide

WhatsApp and Instagram connectors (official APIs where they exist), Outlook and work email, calendar sync, bill pay with a takeover step, native app, family and team spaces.
