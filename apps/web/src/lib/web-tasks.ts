import { and, desc, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { User, WebTask, WebTaskPending, WebTaskStep } from '@/db/schema';
import { ComputerError, type ComputersClient } from './computers';
import { formatWhen } from './format';
import { recordHelmEvent } from './submissions';
import { sendToUser } from './telegram';
import { cropPng, decodePng, sameRegion, type Image } from './web-task-image';
import {
  ADDRESS_REGION,
  LIMITS,
  addressHost,
  cleanTyped,
  clickPoint,
  clickVerdict,
  controlRegion,
  goingInCircles,
  hostAllowed,
  parseStartUrl,
  safeKey,
  siteOf,
  type StepDecision,
} from './web-task-rules';
import type { TaskVision } from './web-task-vision';

/**
 * Website tasks (PRD v3): the person says what they want done on a site, and their agent works
 * through it in a real browser on a private Maritime desktop.
 *
 * The model reads the screen and proposes the next step; code decides whether it happens. Code
 * keeps the task on the sites the person named, reads what's under each click separately, stops
 * for a yes before anything final, and leaves passwords and card numbers to the person. This
 * desktop is separate from the one holding WhatsApp and the other message apps, so a page Helm
 * visits here can never reach those logins.
 *
 * Maritime's network rules don't take effect on desktops yet (docs/maritime-notes.md), so the
 * site limit here is enforced by reading the address bar, not at the network.
 */
export const webDesktopId = (userId: string) => `web_${userId}`;

export interface WebTaskDeps {
  computers: ComputersClient;
  vision: TaskVision;
  now?: Date;
}

export class WebTaskError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ACTIVE = ['running', 'approval', 'needs_you'];
const SETTLE = { action: 'wait', duration: 1.5, no_screenshot: true };
const PNG_B64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

const tasksLink = () => {
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, '');
  return base?.startsWith('https://') ? [[{ text: 'Open in Helm', url: `${base}/tasks` }]] : [];
};

export async function createWebTask(
  db: Db,
  user: User,
  input: { instruction: string; url: string; origin?: 'app' | 'chat' },
  opts: { start?: boolean } = {},
): Promise<WebTask> {
  const instruction = input.instruction.trim();
  if (instruction.length < 5 || instruction.length > 1000)
    throw new WebTaskError(400, 'Say what you want done in a sentence or two.');
  const start = parseStartUrl(input.url);
  if (!start) throw new WebTaskError(400, 'Give a website address like example.com (https only).');
  const begin = opts.start ?? true;
  if (begin) await assertNoneActive(db, user.id);
  // Keep at most the latest screens: an old task's screenshot isn't needed once a new one starts.
  await db
    .update(schema.webTasks)
    .set({ screenshotB64: null })
    .where(and(eq(schema.webTasks.userId, user.id), isNotNull(schema.webTasks.finishedAt)));
  const [row] = await db
    .insert(schema.webTasks)
    .values({
      userId: user.id,
      instruction,
      startUrl: start.url,
      allowedHosts: [siteOf(start.host)],
      origin: input.origin ?? 'app',
      status: begin ? 'running' : 'ready',
    })
    .returning();
  if (begin) await recordStarted(db, row!);
  return row!;
}

async function assertNoneActive(db: Db, userId: string) {
  const [busy] = await db
    .select({ id: schema.webTasks.id })
    .from(schema.webTasks)
    .where(and(eq(schema.webTasks.userId, userId), inArray(schema.webTasks.status, ACTIVE)));
  if (busy)
    throw new WebTaskError(
      409,
      'Helm is already working on a website task. Finish or stop that one first.',
    );
}

const recordStarted = (db: Db, t: WebTask) =>
  recordHelmEvent(
    db,
    t.userId,
    'website.started',
    `Started a website task on ${t.allowedHosts[0]} on your private tasks desktop.`,
    { taskId: t.id, site: t.allowedHosts[0] },
  );

/** Run the task for one slice, as long as nobody else is. Safe to call from polls and cron. */
export async function advanceWebTask(db: Db, id: string, deps: WebTaskDeps): Promise<WebTask> {
  const now = deps.now ?? new Date();
  const [claimed] = await db
    .update(schema.webTasks)
    .set({ lockedUntil: new Date(now.getTime() + LIMITS.lockMs) })
    .where(
      and(
        eq(schema.webTasks.id, id),
        eq(schema.webTasks.status, 'running'),
        or(isNull(schema.webTasks.lockedUntil), lte(schema.webTasks.lockedUntil, now)),
      ),
    )
    .returning();
  if (!claimed) return load(db, id);

  let task = claimed;
  try {
    let computerId = task.computerId;
    const c = computerId
      ? await deps.computers.get(computerId)
      : await deps.computers.ensure(webDesktopId(task.userId));
    if (!computerId) {
      computerId = c.id;
      task = await update(db, task, { computerId });
    }
    if (c.mode === 'human') return await release(db, task); // the person has the desktop
    await deps.computers.wake(computerId);
    const started = Date.now();
    while (task.status === 'running' && Date.now() - started < LIMITS.sliceMs) {
      task =
        task.stepCount >= LIMITS.maxSteps
          ? await finish(
              db,
              task,
              'failed',
              'Helm ran out of steps before finishing, so it stopped.',
              deps,
            )
          : await step(db, task, computerId, deps);
    }
  } catch (err) {
    if (err instanceof ComputerError && (err.status === 429 || err.status === 409))
      return await release(db, task); // no free desktop right now, or the person took over
    console.warn('[web-task] step failed', String(err).slice(0, 300));
    // The model service has bad moments; the page is still there, so try again a couple of times.
    const retries = task.stepsJson.slice(-2).filter((s) => s.sig === 'retry').length;
    task =
      !(err instanceof ComputerError) && retries < 2
        ? await record(db, task, 'Couldn’t read the screen just then; trying again.', 'retry')
        : await finish(
            db,
            task,
            'failed',
            err instanceof ComputerError
              ? 'Helm lost contact with the desktop and stopped.'
              : 'Helm couldn’t read the screen and stopped. Try again in a few minutes.',
            deps,
          );
  }
  if (task.status !== 'running' && task.computerId)
    await deps.computers.sleep(task.computerId).catch(() => {});
  return release(db, task);
}

async function step(db: Db, task: WebTask, cid: string, deps: WebTaskDeps): Promise<WebTask> {
  const { computers, vision } = deps;
  // The first step is always code: open the address the person gave.
  if (task.stepCount === 0) {
    await computers.act(cid, openActions(task.startUrl, 3));
    return record(db, task, `Opened ${task.allowedHosts[0]}.`, 'open');
  }

  const png = await computers.screenshot(cid, 'png');
  const img = decodePng(png);
  // Asked side by side to save a few seconds a step; the address is still checked before acting.
  const decision = vision.decide({
    instruction: task.instruction,
    site: task.allowedHosts.join(', '),
    history: task.stepsJson.slice(-12).map((s) => `- ${s.text}`),
    screenshot: png,
  });
  decision.catch(() => {}); // an early return below leaves it unawaited
  const host = addressHost(await vision.address(cropPng(img, ADDRESS_REGION)));
  if (!host) {
    // Often just a page mid-load: look once more, then hand over rather than guess.
    if (task.stepsJson.at(-1)?.sig !== 'no-address') {
      await computers.act(cid, [{ action: 'wait', duration: 2, no_screenshot: true }]);
      return record(db, task, 'Waited for the page to load.', 'no-address');
    }
    return askForPerson(
      db,
      task,
      cid,
      png,
      "Helm can't tell which site this is, so it stopped here.",
      deps,
    );
  }
  if (!hostAllowed(host, task.allowedHosts))
    return pause(db, task, png, { kind: 'site', host, askedAt: iso(deps) }, deps);

  const d = await decision;
  return act(db, task, cid, d, img, png, host, deps);
}

const openActions = (url: string, pause: number) => [
  { action: 'wait', duration: pause, no_screenshot: true },
  { action: 'key', text: 'ctrl+l', no_screenshot: true },
  { action: 'type', text: url, no_screenshot: true },
  { action: 'key', text: 'Return', no_screenshot: true },
  { action: 'wait', duration: 4, no_screenshot: true },
];

async function act(
  db: Db,
  task: WebTask,
  cid: string,
  d: StepDecision,
  img: Image,
  png: Uint8Array,
  host: string,
  deps: WebTaskDeps,
): Promise<WebTask> {
  const { computers, vision } = deps;
  const sigs = task.stepsJson.map((s) => s.sig ?? '');
  const refuse = (text: string, sig: string) =>
    goingInCircles(sigs, sig)
      ? finish(db, task, 'failed', 'Helm kept trying the same thing and stopped.', deps, png)
      : record(db, task, text, sig);

  switch (d.action) {
    case 'done':
      return finish(db, task, 'done', (d.message ?? d.see).slice(0, 600), deps, png);
    case 'stuck':
      return finish(db, task, 'failed', (d.message ?? d.see).slice(0, 600), deps, png);
    case 'login':
      return askForPerson(db, task, cid, png, 'This site needs you to sign in.', deps);
    case 'ask':
      if (!d.message) return refuse('Had a question but no words for it.', 'ask');
      return pause(
        db,
        task,
        png,
        { kind: 'question', question: d.message.slice(0, 400), askedAt: iso(deps) },
        deps,
      );
    case 'wait': {
      if (goingInCircles(sigs, 'wait'))
        return finish(db, task, 'failed', 'The page never finished loading.', deps, png);
      await computers.act(cid, [{ action: 'wait', duration: 3, no_screenshot: true }]);
      return record(db, task, 'Waited for the page.', 'wait');
    }
    case 'scroll': {
      const sig = `scroll:${d.direction ?? 'down'}`;
      if (goingInCircles(sigs, sig))
        return finish(
          db,
          task,
          'failed',
          'Helm kept trying the same thing and stopped.',
          deps,
          png,
        );
      await computers.act(cid, [
        {
          action: 'scroll',
          coordinate: [600, 400],
          scroll_direction: d.direction === 'up' ? 'up' : 'down',
          scroll_amount: 5,
          no_screenshot: true,
        },
        SETTLE,
      ]);
      return record(db, task, `Scrolled ${d.direction === 'up' ? 'up' : 'down'}.`, sig);
    }
    case 'key': {
      const key = safeKey(d.key);
      if (!key) return refuse('A key Helm doesn’t use was suggested; skipped it.', 'bad-key');
      if (goingInCircles(sigs, `key:${key}`))
        return finish(
          db,
          task,
          'failed',
          'Helm kept trying the same thing and stopped.',
          deps,
          png,
        );
      await computers.act(cid, [{ action: 'key', text: key, no_screenshot: true }, SETTLE]);
      return record(db, task, `Pressed ${key.replace('_', ' ')}.`, `key:${key}`, false);
    }
    case 'navigate': {
      const target = parseStartUrl(d.url ?? '');
      if (!target)
        return refuse(
          'An address that isn’t a normal https link was suggested; skipped it.',
          'bad-url',
        );
      if (!hostAllowed(target.host, task.allowedHosts))
        return pause(db, task, png, { kind: 'site', host: target.host, askedAt: iso(deps) }, deps);
      const sig = `go:${target.url}`;
      if (goingInCircles(sigs, sig))
        return finish(
          db,
          task,
          'failed',
          'Helm kept trying the same thing and stopped.',
          deps,
          png,
        );
      await computers.act(cid, openActions(target.url, 0));
      return record(db, task, `Went to ${target.host}.`, sig);
    }
    case 'type': {
      if (!task.fieldFocused)
        return refuse('Tried to type with no box selected; skipped it.', 'no-field');
      const text = cleanTyped(d.text);
      if (!text) return refuse('The text to type wasn’t usable; skipped it.', 'bad-text');
      await computers.act(cid, [{ action: 'type', text, no_screenshot: true }, SETTLE]);
      return record(db, task, `Typed “${text}”.`, `type:${text}`, false);
    }
    case 'click': {
      const pt = clickPoint(d.x, d.y);
      if (!pt) return refuse('A click outside the page was suggested; skipped it.', 'bad-click');
      const sig = `click:${pt[0]}:${pt[1]}`;
      if (goingInCircles(sigs, sig))
        return finish(
          db,
          task,
          'failed',
          'Helm kept trying the same thing and stopped.',
          deps,
          png,
        );
      const control = await vision.control(cropPng(img, controlRegion(pt), 2, pt));
      const verdict = clickVerdict(control);
      if (verdict === 'secret')
        return askForPerson(
          db,
          task,
          cid,
          png,
          'This step needs a password or card details. Those are yours to enter.',
          deps,
        );
      const label = control.label.trim().slice(0, 120) || 'an unlabelled button';
      if (verdict === 'approve')
        return pause(
          db,
          task,
          png,
          {
            kind: 'click',
            x: pt[0],
            y: pt[1],
            label,
            host,
            field: control.kind === 'field',
            askedAt: iso(deps),
          },
          deps,
        );
      await computers.act(cid, [
        { action: 'left_click', coordinate: pt, no_screenshot: true },
        SETTLE,
      ]);
      return record(db, task, `Clicked “${label}”.`, sig, control.kind === 'field');
    }
  }
}

const iso = (deps: { now?: Date }) => (deps.now ?? new Date()).toISOString();

/** Save a change, unless the person stopped the task meanwhile (then return what they left). */
async function update(db: Db, task: WebTask, set: Partial<typeof schema.webTasks.$inferInsert>) {
  const [row] = await db
    .update(schema.webTasks)
    .set(set)
    .where(and(eq(schema.webTasks.id, task.id), eq(schema.webTasks.status, 'running')))
    .returning();
  return row ?? load(db, task.id);
}

function record(db: Db, task: WebTask, text: string, sig: string, fieldFocused = false) {
  const entry: WebTaskStep = { at: new Date().toISOString(), text, sig };
  return update(db, task, {
    stepCount: task.stepCount + 1,
    stepsJson: [...task.stepsJson, entry],
    fieldFocused,
  });
}

async function load(db: Db, id: string): Promise<WebTask> {
  const [row] = await db.select().from(schema.webTasks).where(eq(schema.webTasks.id, id));
  if (!row) throw new WebTaskError(404, 'No such task');
  return row;
}

async function release(db: Db, task: WebTask) {
  const [row] = await db
    .update(schema.webTasks)
    .set({ lockedUntil: null })
    .where(eq(schema.webTasks.id, task.id))
    .returning();
  return row ?? task;
}

const PENDING_TEXT = (p: WebTaskPending) => {
  switch (p.kind) {
    case 'click':
      return `Helm is ready to click “${p.label}” on ${p.host}. It won’t until you say yes.`;
    case 'site':
      return `Your website task moved to ${p.host}. Helm is waiting for your OK to continue there.`;
    case 'login':
      return `${p.reason} Open your private desktop to do this step.`;
    case 'question':
      return `Helm has a question about your website task: ${p.question}`;
  }
};

async function pause(
  db: Db,
  task: WebTask,
  png: Uint8Array,
  pending: WebTaskPending,
  _deps: WebTaskDeps,
) {
  const status = pending.kind === 'click' || pending.kind === 'site' ? 'approval' : 'needs_you';
  const row = await update(db, task, {
    status,
    pendingJson: pending,
    screenshotB64: PNG_B64(png),
  });
  if (row.status !== status) return row;
  const text = PENDING_TEXT(pending);
  await recordHelmEvent(db, task.userId, 'website.waiting', text, {
    taskId: task.id,
    kind: pending.kind,
  });
  await sendToUser(db, task.userId, text, tasksLink());
  return row;
}

async function askForPerson(
  db: Db,
  task: WebTask,
  cid: string,
  png: Uint8Array,
  reason: string,
  deps: WebTaskDeps,
) {
  const link = await deps.computers.viewer(
    cid,
    'control',
    LIMITS.takeoverTtlS,
    'Helm needs you for this step',
  );
  return pause(
    db,
    task,
    png,
    { kind: 'login', reason, url: link.url, expiresAt: link.expiresAt, askedAt: iso(deps) },
    deps,
  );
}

async function finish(
  db: Db,
  task: WebTask,
  status: 'done' | 'failed' | 'stopped',
  result: string,
  deps: Pick<WebTaskDeps, 'now'>,
  png?: Uint8Array,
) {
  const [row] = await db
    .update(schema.webTasks)
    .set({
      status,
      result,
      pendingJson: null,
      finishedAt: deps.now ?? new Date(),
      ...(png ? { screenshotB64: PNG_B64(png) } : {}),
    })
    .where(and(eq(schema.webTasks.id, task.id), inArray(schema.webTasks.status, ACTIVE)))
    .returning();
  if (!row) return load(db, task.id);
  const site = task.allowedHosts[0];
  await recordHelmEvent(
    db,
    task.userId,
    'website.finished',
    status === 'done'
      ? `Finished your website task on ${site}.`
      : status === 'stopped'
        ? `Stopped your website task on ${site}.`
        : `Couldn’t finish your website task on ${site}: ${result}`,
    { taskId: task.id, status },
  );
  if (status !== 'stopped')
    await sendToUser(
      db,
      task.userId,
      status === 'done'
        ? `Your website task on ${site} is finished. Open Helm to see the final screen.`
        : `Helm couldn’t finish your website task on ${site}. Open Helm to see why.`,
      tasksLink(),
    );
  return row;
}

export type WebTaskAction =
  | { action: 'start' }
  | { action: 'approve' }
  | { action: 'stop' }
  | { action: 'resume' }
  | { action: 'takeover' }
  | { action: 'answer'; text: string };

/** The person's answer. Each approval moves the task out of "approval", so it can only act once. */
export async function respondToWebTask(
  db: Db,
  user: User,
  id: string,
  a: WebTaskAction,
  deps: WebTaskDeps,
): Promise<WebTask> {
  const [task] = await db
    .select()
    .from(schema.webTasks)
    .where(and(eq(schema.webTasks.id, id), eq(schema.webTasks.userId, user.id)));
  if (!task) throw new WebTaskError(404, 'No such task');
  const conflict = () =>
    new WebTaskError(409, 'This task has moved on. Refresh to see where it is.');

  const claim = async (from: string, set: Partial<typeof schema.webTasks.$inferInsert>) => {
    const [row] = await db
      .update(schema.webTasks)
      .set(set)
      .where(and(eq(schema.webTasks.id, id), eq(schema.webTasks.status, from)))
      .returning();
    if (!row) throw conflict();
    return row;
  };

  const pending = task.pendingJson;
  switch (a.action) {
    case 'start': {
      await assertNoneActive(db, user.id);
      const row = await claim('ready', { status: 'running' });
      await recordStarted(db, row);
      return row;
    }
    case 'stop': {
      if (task.status === 'ready')
        return claim('ready', {
          status: 'stopped',
          finishedAt: deps.now ?? new Date(),
          result: 'You decided not to run this.',
        });
      if (!ACTIVE.includes(task.status)) throw conflict();
      const row = await finish(db, task, 'stopped', 'You stopped this.', deps);
      if (task.computerId) await deps.computers.sleep(task.computerId).catch(() => {});
      return row;
    }
    case 'resume': {
      if (pending?.kind !== 'login') throw conflict();
      return claim('needs_you', {
        status: 'running',
        pendingJson: null,
        lockedUntil: null,
        fieldFocused: false,
      });
    }
    case 'answer': {
      if (pending?.kind !== 'question') throw conflict();
      const answer = a.text.trim().slice(0, 500);
      if (!answer) throw new WebTaskError(400, 'Type an answer first.');
      return claim('needs_you', {
        status: 'running',
        pendingJson: null,
        instruction: `${task.instruction}\n\nHelm asked: ${pending.question}\nThe person answered: ${answer}`,
      });
    }
    case 'takeover': {
      if (!task.computerId || !ACTIVE.includes(task.status) || task.status === 'running')
        throw conflict();
      const link = await deps.computers.viewer(
        task.computerId,
        'control',
        LIMITS.takeoverTtlS,
        'Do this step yourself',
      );
      return claim(task.status, {
        status: 'needs_you',
        pendingJson: {
          kind: 'login',
          reason: 'You’re doing this step yourself.',
          url: link.url,
          expiresAt: link.expiresAt,
          askedAt: iso(deps),
        },
      });
    }
    case 'approve': {
      if (task.status !== 'approval' || !pending) throw conflict();
      if (pending.kind === 'site') {
        const row = await claim('approval', {
          status: 'running',
          pendingJson: null,
          allowedHosts: [...task.allowedHosts, siteOf(pending.host)],
        });
        await recordHelmEvent(
          db,
          user.id,
          'website.approved',
          `You allowed your website task to continue on ${pending.host}.`,
          { taskId: id, kind: 'site' },
        );
        return row;
      }
      if (pending.kind !== 'click') throw conflict();
      const now = deps.now ?? new Date();
      // Holding the lock keeps a page poll from taking the next step while this one is checked.
      const row = await claim('approval', {
        status: 'running',
        pendingJson: null,
        lockedUntil: new Date(now.getTime() + LIMITS.lockMs),
      });
      const text = await carryOutApproved(row, pending, task.screenshotB64, now, deps);
      const out = await record(
        db,
        row,
        text.line,
        `approved:${pending.x}:${pending.y}`,
        text.clicked && Boolean(pending.field),
      );
      await recordHelmEvent(db, user.id, 'website.approved', text.line, {
        taskId: id,
        kind: 'click',
        clicked: text.clicked,
      });
      return release(db, out);
    }
  }
}

/** Click only if the page still shows what the person approved. Otherwise nothing happens. */
async function carryOutApproved(
  task: WebTask,
  p: Extract<WebTaskPending, { kind: 'click' }>,
  approvedPng: string | null,
  now: Date,
  deps: WebTaskDeps,
): Promise<{ line: string; clicked: boolean }> {
  const notClicked = {
    line: `The page changed before “${p.label}” could be clicked, so Helm didn’t click it.`,
    clicked: false,
  };
  if (
    now.getTime() - new Date(p.askedAt).getTime() > LIMITS.approvalTtlMs ||
    !approvedPng ||
    !task.computerId
  )
    return notClicked;
  await deps.computers.wake(task.computerId);
  const before = decodePng(Buffer.from(approvedPng, 'base64'));
  const current = decodePng(await deps.computers.screenshot(task.computerId, 'png'));
  const host = addressHost(await deps.vision.address(cropPng(current, ADDRESS_REGION)));
  if (host !== p.host || !sameRegion(before, current, controlRegion([p.x, p.y]))) return notClicked;
  await deps.computers.act(task.computerId, [
    { action: 'left_click', coordinate: [p.x, p.y], no_screenshot: true },
    { action: 'wait', duration: 3, no_screenshot: true },
  ]);
  return { line: `You approved it: clicked “${p.label}”.`, clicked: true };
}

/** Delete the tasks desktop and every login on it. The message-apps desktop isn't touched. */
export async function forgetTasksDesktop(db: Db, user: User, computers: ComputersClient) {
  await assertNoneActive(db, user.id);
  const [last] = await db
    .select({ computerId: schema.webTasks.computerId })
    .from(schema.webTasks)
    .where(and(eq(schema.webTasks.userId, user.id), isNotNull(schema.webTasks.computerId)))
    .orderBy(desc(schema.webTasks.createdAt))
    .limit(1);
  if (!last?.computerId) return false;
  await computers.remove(last.computerId).catch((err: unknown) => {
    if (!(err instanceof ComputerError && err.status === 404)) throw err;
  });
  await db
    .update(schema.webTasks)
    .set({ computerId: null, screenshotB64: null })
    .where(eq(schema.webTasks.userId, user.id));
  await recordHelmEvent(
    db,
    user.id,
    'website.finished',
    'Deleted your private tasks desktop and the logins on it.',
    { deleted: true },
  );
  return true;
}

/** Heartbeat: carry on tasks whose page was closed, and close ones nobody came back to. */
export async function advanceDueWebTasks(db: Db, deps: WebTaskDeps, userId?: string) {
  const now = deps.now ?? new Date();
  const scope = userId ? [eq(schema.webTasks.userId, userId)] : [];
  const stale = await db
    .select()
    .from(schema.webTasks)
    .where(
      and(
        ...scope,
        inArray(schema.webTasks.status, ['approval', 'needs_you']),
        lte(schema.webTasks.updatedAt, new Date(now.getTime() - LIMITS.abandonMs)),
      ),
    )
    .limit(10);
  for (const t of stale) {
    await finish(db, t, 'stopped', 'Stopped because nobody answered for a day.', deps);
    if (t.computerId) await deps.computers.sleep(t.computerId).catch(() => {});
  }
  const running = await db
    .select({ id: schema.webTasks.id })
    .from(schema.webTasks)
    .where(
      and(
        ...scope,
        eq(schema.webTasks.status, 'running'),
        or(isNull(schema.webTasks.lockedUntil), lte(schema.webTasks.lockedUntil, now)),
      ),
    )
    .limit(3);
  for (const r of running) await advanceWebTask(db, r.id, deps);
  return running.length;
}

export function webTaskView(t: WebTask, tz: string) {
  const p = t.pendingJson;
  return {
    id: t.id,
    instruction: t.instruction.split('\n\nHelm asked:')[0]!,
    site: t.allowedHosts[0] ?? '',
    status: t.status,
    steps: t.stepsJson.map((s) => s.text),
    pending:
      p?.kind === 'click'
        ? { kind: p.kind, label: p.label, host: p.host }
        : p?.kind === 'site'
          ? { kind: p.kind, host: p.host }
          : p?.kind === 'login'
            ? {
                kind: p.kind,
                reason: p.reason,
                url: p.url,
                expiresLabel: formatWhen(p.expiresAt, tz),
              }
            : p
              ? { kind: p.kind, question: p.question }
              : null,
    result: t.result,
    hasScreenshot: Boolean(t.screenshotB64),
    createdLabel: formatWhen(t.createdAt.toISOString(), tz),
  };
}
export type WebTaskView = ReturnType<typeof webTaskView>;

export async function listWebTasks(db: Db, user: User) {
  const rows = await db
    .select()
    .from(schema.webTasks)
    .where(eq(schema.webTasks.userId, user.id))
    .orderBy(desc(schema.webTasks.createdAt))
    .limit(15);
  return rows.map((r) => webTaskView(r, user.timezone));
}

/** This server's task dependencies, or null when desktops or the vision model aren't set up. */
export async function webTaskDepsFromEnv(): Promise<WebTaskDeps | null> {
  const { computersFromEnv } = await import('./computers');
  const { geminiTaskVision } = await import('./web-task-vision');
  const computers = computersFromEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!computers || !key) return null;
  return { computers, vision: geminiTaskVision(key) };
}
