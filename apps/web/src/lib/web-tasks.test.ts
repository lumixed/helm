import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import type { ComputersClient } from './computers';
import {
  addressHost,
  clickPoint,
  clickVerdict,
  cleanTyped,
  hostAllowed,
  parseStartUrl,
  safeKey,
} from './web-task-rules';
import type { ControlRead, StepDecision } from './web-task-rules';
import type { TaskVision } from './web-task-vision';
import {
  advanceDueWebTasks,
  advanceWebTask,
  createWebTask,
  forgetTasksDesktop,
  respondToWebTask,
  type WebTaskDeps,
} from './web-tasks';

function frame(shade = 255) {
  const p = new PNG({ width: 1200, height: 750 });
  p.data.fill(shade);
  return new Uint8Array(PNG.sync.write(p));
}

describe('website task rules', () => {
  it('takes only public https sites', () => {
    expect(parseStartUrl('mylibrary.org/account')?.host).toBe('mylibrary.org');
    for (const bad of [
      'http://a.com',
      'localhost:3000',
      'https://10.0.0.1',
      'https://u:p@a.com',
      'not a site',
      'file:///etc/passwd',
      'https://printer.local',
    ])
      expect(parseStartUrl(bad)).toBeNull();
  });
  it('allows a site and its subdomains, not lookalikes', () => {
    expect(hostAllowed('books.lib.org', ['lib.org'])).toBe(true);
    expect(hostAllowed('lib.org.evil.com', ['lib.org'])).toBe(false);
    expect(hostAllowed('evillib.org', ['lib.org'])).toBe(false);
  });
  it('reads the host from the address bar and refuses what is not a web address', () => {
    expect(addressHost('httpbin.org/forms/post')).toBe('httpbin.org');
    expect(addressHost('https://A.example.com:8443/x?y=1')).toBe('a.example.com');
    expect(addressHost('Not secure | a.example.com/x')).toBe('a.example.com');
    for (const bad of [
      '',
      'about:blank',
      'chrome://settings',
      'file:///x',
      'Search Google or type a URL',
    ])
      expect(addressHost(bad)).toBeNull();
  });
  it('stops for approval on commit words whatever the model called the control', () => {
    const v = (label: string, kind: ControlRead['kind']) => clickVerdict({ label, kind });
    expect(v('Next page', 'expand')).toBe('go');
    expect(v('Sign in', 'link')).toBe('go');
    expect(v('Place order', 'link')).toBe('approve');
    expect(v('Renew all', 'expand')).toBe('approve');
    expect(v('Go', 'commit')).toBe('approve');
    expect(v('???', 'unclear')).toBe('approve');
    expect(v('', 'link')).toBe('approve');
    expect(v('Card number', 'secret_field')).toBe('secret');
  });
  it('has no Enter or Space, and keeps clicks on the page', () => {
    for (const k of ['Return', 'Enter', 'space', 'ctrl+l', 'alt+Left', 'Tab'])
      expect(safeKey(k)).toBeNull();
    expect(safeKey('PageDown')).toBe('Page_Down');
    expect(clickPoint(500, 500)).toEqual([600, 375]);
    expect(clickPoint(500, 100)).toBeNull(); // the address bar
    expect(clickPoint(500, 990)).toBeNull(); // the taskbar
    expect(clickPoint(1200, 500)).toBeNull();
  });
  it('types one clean line', () => {
    expect(cleanTyped('hello\nworld\r')).toBe('hello world');
    expect(cleanTyped('x'.repeat(301))).toBeNull();
  });
});

let db: Db;
let user: User;
let acted: Record<string, unknown>[][];
let mode: string;
let removed: string[];
let shot: Uint8Array;
let addresses: string[];
let decisions: StepDecision[];
let controls: ControlRead[];

const see = (over: Partial<StepDecision>): StepDecision => ({
  see: 'A page',
  action: 'wait',
  ...over,
});

const computers = {
  ensure: async () => ({ id: 'pc1', status: 'ready', mode, lastTakeoverResult: null }),
  get: async () => ({ id: 'pc1', status: 'ready', mode, lastTakeoverResult: null }),
  wake: async () => {},
  sleep: async () => {},
  remove: async (id: string) => void removed.push(id),
  act: async (_: string, a: Record<string, unknown>[]) => void acted.push(a),
  screenshot: async () => shot,
  zoom: async () => shot,
  viewer: async () => ({
    url: 'https://maritime.sh/computer/pc1?t=x',
    expiresAt: '2026-11-10T00:00:00.000Z',
  }),
} as unknown as ComputersClient;

const vision: TaskVision = {
  address: async () => addresses.shift() ?? 'lib.org/page',
  control: async () => controls.shift() ?? { label: 'Details', kind: 'link' },
  decide: async () => decisions.shift() ?? see({ action: 'done', message: 'Finished.' }),
};
const deps: WebTaskDeps = { computers, vision };

const clicks = () => acted.flat().filter((a) => a.action === 'left_click');

beforeEach(async () => {
  db = await connect(undefined);
  [user] = (await db
    .insert(schema.users)
    .values({ email: 'a@b.co', name: 'A', timezone: 'America/Vancouver' })
    .returning()) as [User];
  acted = [];
  mode = 'agent';
  removed = [];
  shot = frame();
  addresses = [];
  decisions = [];
  controls = [];
});

const newTask = () =>
  createWebTask(db, user, { instruction: 'Renew my books', url: 'www.lib.org' });

describe('website tasks', () => {
  it('opens the site in code, follows safe steps, and reports the result', async () => {
    const t = await newTask();
    expect(t.allowedHosts).toEqual(['lib.org']);
    decisions = [
      see({ action: 'click', x: 500, y: 500 }),
      see({ action: 'done', message: 'All renewed.' }),
    ];
    const out = await advanceWebTask(db, t.id, deps);
    expect(out.status).toBe('done');
    expect(out.result).toBe('All renewed.');
    expect(acted[0]!.some((a) => a.text === 'https://www.lib.org/')).toBe(true);
    expect(clicks()).toHaveLength(1);
    expect(out.stepsJson.map((s) => s.text)).toEqual(['Opened lib.org.', 'Clicked “Details”.']);
  });

  it('never carries out a commit click until the person approves, and only once', async () => {
    const t = await newTask();
    decisions = [see({ action: 'click', x: 500, y: 500 })];
    controls = [{ label: 'Pay $40', kind: 'commit' }];
    const paused = await advanceWebTask(db, t.id, deps);
    expect(paused.status).toBe('approval');
    expect(clicks()).toHaveLength(0);
    expect(paused.screenshotB64).toBeTruthy();

    const after = await respondToWebTask(db, user, t.id, { action: 'approve' }, deps);
    expect(after.status).toBe('running');
    expect(clicks()).toHaveLength(1);
    await expect(respondToWebTask(db, user, t.id, { action: 'approve' }, deps)).rejects.toThrow(
      /moved on/,
    );
    expect(clicks()).toHaveLength(1);
  });

  it('does not click an approved button when the page has changed', async () => {
    const t = await newTask();
    decisions = [see({ action: 'click', x: 500, y: 500 })];
    controls = [{ label: 'Pay $40', kind: 'commit' }];
    await advanceWebTask(db, t.id, deps);
    shot = frame(0); // the page swapped after the person looked at it
    const after = await respondToWebTask(db, user, t.id, { action: 'approve' }, deps);
    expect(clicks()).toHaveLength(0);
    expect(after.stepsJson.at(-1)!.text).toMatch(/didn’t click/);
  });

  it('does not click an approved button after the address changed', async () => {
    const t = await newTask();
    decisions = [see({ action: 'click', x: 500, y: 500 })];
    controls = [{ label: 'Pay $40', kind: 'commit' }];
    addresses = ['lib.org/cart', 'pay.lib.org/cart'];
    await advanceWebTask(db, t.id, deps);
    await respondToWebTask(db, user, t.id, { action: 'approve' }, deps);
    expect(clicks()).toHaveLength(0);
  });

  it('ignores an approval that has gone stale', async () => {
    const t = await newTask();
    decisions = [see({ action: 'click', x: 500, y: 500 })];
    controls = [{ label: 'Pay', kind: 'commit' }];
    await advanceWebTask(db, t.id, deps);
    const later = new Date(Date.now() + 31 * 60_000);
    await respondToWebTask(db, user, t.id, { action: 'approve' }, { ...deps, now: later });
    expect(clicks()).toHaveLength(0);
  });

  it('stops before acting on another site and needs a yes to go on', async () => {
    const t = await newTask();
    addresses = ['evil.example/phish'];
    const paused = await advanceWebTask(db, t.id, deps);
    expect(paused.status).toBe('approval');
    expect(paused.pendingJson).toMatchObject({ kind: 'site', host: 'evil.example' });
    const on = await respondToWebTask(db, user, t.id, { action: 'approve' }, deps);
    expect(on.allowedHosts).toEqual(['lib.org', 'evil.example']);
  });

  it('asks before the model navigates off-site', async () => {
    const t = await newTask();
    decisions = [see({ action: 'navigate', url: 'https://bank.example/transfer' })];
    const paused = await advanceWebTask(db, t.id, deps);
    expect(paused.pendingJson).toMatchObject({ kind: 'site', host: 'bank.example' });
    expect(acted.flat().some((a) => String(a.text).includes('bank.example'))).toBe(false);
  });

  it('hands passwords and card fields to the person', async () => {
    const t = await newTask();
    decisions = [see({ action: 'click', x: 500, y: 500 })];
    controls = [{ label: 'Password', kind: 'secret_field' }];
    const paused = await advanceWebTask(db, t.id, deps);
    expect(paused.status).toBe('needs_you');
    expect(paused.pendingJson).toMatchObject({ kind: 'login' });
    expect(clicks()).toHaveLength(0);
    const back = await respondToWebTask(db, user, t.id, { action: 'resume' }, deps);
    expect(back.status).toBe('running');
  });

  it('only types after clicking a text box, on one line', async () => {
    const t = await newTask();
    decisions = [
      see({ action: 'type', text: 'no box yet' }),
      see({ action: 'click', x: 500, y: 500 }),
      see({ action: 'type', text: 'Ada\nLovelace' }),
    ];
    controls = [{ label: 'Name', kind: 'field' }];
    await advanceWebTask(db, t.id, deps);
    const typed = acted
      .flat()
      .filter((a) => a.action === 'type')
      .map((a) => a.text);
    expect(typed).toEqual(['https://www.lib.org/', 'Ada Lovelace']);
  });

  it('refuses a key that could submit, and stops when going in circles', async () => {
    const t = await newTask();
    decisions = Array.from({ length: 6 }, () => see({ action: 'key', key: 'Return' }));
    const out = await advanceWebTask(db, t.id, deps);
    expect(out.status).toBe('failed');
    expect(out.result).toMatch(/same thing/);
    expect(acted.flat().filter((a) => a.action === 'key' && a.text === 'Return')).toHaveLength(1); // opening the site
  });

  it('runs one task at a time per person', async () => {
    await newTask();
    await expect(newTask()).rejects.toThrow(/already working/);
  });

  it('leaves the desktop alone while the person has it', async () => {
    const t = await newTask();
    mode = 'human';
    const out = await advanceWebTask(db, t.id, deps);
    expect(out.status).toBe('running');
    expect(acted).toHaveLength(0);
  });

  it('keeps people out of each other’s tasks', async () => {
    const t = await newTask();
    const [other] = await db
      .insert(schema.users)
      .values({ email: 'c@d.co', name: 'C', timezone: 'UTC' })
      .returning();
    await expect(
      respondToWebTask(db, other as User, t.id, { action: 'stop' }, deps),
    ).rejects.toThrow(/No such task/);
  });

  it('a task from chat waits for Start', async () => {
    const t = await createWebTask(
      db,
      user,
      { instruction: 'Renew my books', url: 'lib.org', origin: 'chat' },
      { start: false },
    );
    const untouched = await advanceWebTask(db, t.id, deps);
    expect(untouched.status).toBe('ready');
    expect(acted).toHaveLength(0);
    expect((await respondToWebTask(db, user, t.id, { action: 'start' }, deps)).status).toBe(
      'running',
    );
  });

  it('adds the person’s answer to what the model is told', async () => {
    const t = await newTask();
    decisions = [see({ action: 'ask', message: 'Which card?' })];
    await advanceWebTask(db, t.id, deps);
    const back = await respondToWebTask(
      db,
      user,
      t.id,
      { action: 'answer', text: 'The blue one' },
      deps,
    );
    expect(back.instruction).toContain('The blue one');
  });

  it('stops tasks nobody answered, and deletes the desktop on request', async () => {
    const t = await newTask();
    decisions = [see({ action: 'ask', message: 'Which?' })];
    await advanceWebTask(db, t.id, deps);
    await advanceDueWebTasks(db, { ...deps, now: new Date(Date.now() + 25 * 3600_000) }, user.id);
    const [row] = await db.select().from(schema.webTasks).where(eq(schema.webTasks.id, t.id));
    expect(row!.status).toBe('stopped');
    expect(await forgetTasksDesktop(db, user, computers)).toBe(true);
    expect(removed).toEqual(['pc1']);
  });
});
