import fs from 'node:fs';
import path from 'node:path';
import {
  AgentRuntimeConfig,
  DEFAULT_WORK_HOURS,
  type ReminderSchedule,
  type Routines,
  type WorkHours,
} from '@helm/shared';

/** Everything outside /data is disposable on Maritime (PRD section 7, "Memory"). */
export const DATA_DIR =
  process.env.HELM_DATA_DIR ??
  (fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data'));

/** Process-level settings that never change while running. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** Maritime gives each /chat delivery 30 s. Answer well inside it. */
  replyBudgetMs: Number(process.env.HELM_REPLY_BUDGET_MS ?? 20_000),
  version: process.env.HELM_AGENT_VERSION ?? '0.3.0',
  debugInbound: process.env.HELM_DEBUG_INBOUND === '1',
};

export const paths = {
  memory: path.join(DATA_DIR, 'memory'),
  outbox: path.join(DATA_DIR, 'outbox.jsonl'),
  processed: path.join(DATA_DIR, 'memory', 'processed.json'),
  /** Written by the backend through the Files API. Same file as AGENT_CONFIG_PATH on Maritime. */
  runtimeConfig: process.env.HELM_CONFIG_PATH ?? path.join(DATA_DIR, 'helm', 'config.json'),
};

for (const dir of [DATA_DIR, paths.memory]) fs.mkdirSync(dir, { recursive: true });

export interface Runtime {
  studentId: string;
  backendUrl: string;
  agentToken: string;
  timezone: string;
  briefTime: string;
  heartbeatCron: string;
  demoMode: boolean;
  /** From the settings file only; each one is published as its own Maritime cron. */
  reminders: ReminderSchedule[];
  /** Evening check-in / weekly review (settings file only); each is its own Maritime cron. */
  routines: Routines;
  /** Work window and days off for time-blocking (settings file only). */
  workHours: WorkHours;
  /** Where the values came from, for the status endpoint. */
  source: 'env+file' | 'file' | 'env' | 'none';
  error?: string;
}

let cache: { mtimeMs: number; value: Runtime } | null = null;

/** Secrets and identity come from env vars; changeable settings from the config file. */
export function runtime(file = paths.runtimeConfig): Runtime {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(file);
  } catch {
    /* no file yet */
  }
  if (stat && cache && cache.mtimeMs === stat.mtimeMs) return cache.value;

  const fromEnv = envRuntime();
  if (!stat) return fromEnv;

  let value: Runtime;
  try {
    const parsed = AgentRuntimeConfig.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (parsed.success) {
      const f = parsed.data;
      value = {
        ...fromEnv,
        studentId: f.studentId ?? fromEnv.studentId,
        agentToken: f.agentToken ?? fromEnv.agentToken,
        backendUrl: f.backendUrl ? f.backendUrl.replace(/\/+$/, '') : fromEnv.backendUrl,
        timezone: f.timezone ?? fromEnv.timezone,
        briefTime: f.briefTime ?? fromEnv.briefTime,
        heartbeatCron: f.heartbeatCron ?? fromEnv.heartbeatCron,
        demoMode: f.demoMode ?? fromEnv.demoMode,
        reminders: f.reminders ?? [],
        routines: f.routines ?? {},
        workHours: f.workHours ?? DEFAULT_WORK_HOURS,
        source: fromEnv.studentId ? 'env+file' : 'file',
      };
    } else {
      value = {
        ...fromEnv,
        error: `config file invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      };
    }
  } catch (err) {
    value = { ...fromEnv, error: `config file unreadable: ${String(err)}` };
  }
  cache = { mtimeMs: stat.mtimeMs, value };
  return value;
}

function envRuntime(): Runtime {
  const e = process.env;
  const studentId = e.HELM_STUDENT_ID ?? '';
  return {
    studentId,
    backendUrl: (e.HELM_BACKEND_URL ?? '').replace(/\/+$/, ''),
    agentToken: e.HELM_AGENT_TOKEN ?? '',
    timezone: e.TZ || 'America/Vancouver',
    briefTime: e.HELM_BRIEF_TIME ?? '07:30',
    heartbeatCron: e.HELM_HEARTBEAT_CRON ?? '*/15 * * * *',
    demoMode: e.DEMO_MODE === 'true',
    reminders: [],
    routines: {},
    workHours: DEFAULT_WORK_HOURS,
    source: studentId ? 'env' : 'none',
  };
}
