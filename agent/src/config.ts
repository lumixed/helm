import fs from 'node:fs';
import path from 'node:path';

/** Everything outside /data is disposable on Maritime (PRD section 7, "Memory"). */
export const DATA_DIR =
  process.env.HELM_DATA_DIR ??
  (fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data'));

export const config = {
  port: Number(process.env.PORT ?? 8787),
  backendUrl: (process.env.HELM_BACKEND_URL ?? '').replace(/\/+$/, ''),
  agentToken: process.env.HELM_AGENT_TOKEN ?? '',
  studentId: process.env.HELM_STUDENT_ID ?? '',
  timezone: process.env.TZ || 'America/Vancouver',
  briefTime: process.env.HELM_BRIEF_TIME ?? '07:30',
  heartbeatCron: process.env.HELM_HEARTBEAT_CRON ?? '*/15 * * * *',
  /** Maritime gives each /chat delivery 30 s. Answer well inside it. */
  replyBudgetMs: Number(process.env.HELM_REPLY_BUDGET_MS ?? 20_000),
  version: process.env.HELM_AGENT_VERSION ?? '0.1.0',
  debugInbound: process.env.HELM_DEBUG_INBOUND === '1',
};

export const paths = {
  memory: path.join(DATA_DIR, 'memory'),
  outbox: path.join(DATA_DIR, 'outbox.jsonl'),
  processed: path.join(DATA_DIR, 'memory', 'processed.json'),
};

for (const dir of [DATA_DIR, paths.memory]) fs.mkdirSync(dir, { recursive: true });
