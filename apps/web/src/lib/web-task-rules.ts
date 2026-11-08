import { z } from 'zod';

/**
 * Website tasks: the rules code applies to everything the model proposes. The model reads the
 * screen and suggests the next action; these functions decide whether it happens. A web page can
 * say anything to the model, so nothing here trusts the model's own opinion of what is safe.
 */

/** Screenshots and action coordinates on a default Maritime desktop. */
export const FRAME = { width: 1200, height: 750 } as const;
/** The web page itself. Above is the browser's own tabs and address bar, below is the taskbar. */
export const PAGE_AREA = { top: 106, bottom: 720 } as const;
/**
 * The start of the address text, cropped on its own so the model reading it can't see the page.
 * Only the host matters; a very long address (tracking links) makes the model stall.
 */
export const ADDRESS_REGION: Region = [118, 66, 640, 98];

export const LIMITS = {
  maxSteps: 30,
  /** One serverless call runs steps for at most this long (the route is allowed 60 s). */
  sliceMs: 25_000,
  lockMs: 58_000,
  /** An approval older than this no longer counts: the page has probably moved on. */
  approvalTtlMs: 30 * 60_000,
  /** Nobody answered: stop rather than keep a task open forever. */
  abandonMs: 24 * 60 * 60_000,
  takeoverTtlS: 900,
  maxTyped: 300,
} as const;

export type Region = [number, number, number, number];

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;
const PRIVATE_NAME = /(^|\.)(local|localhost|internal|intranet|lan|home|corp)$/;

/** A public host name, or null for an IP address, a local name or anything malformed. */
function publicHost(raw: string): string | null {
  const host = raw.toLowerCase().replace(/\.$/, '');
  if (!HOST.test(host) || IPV4.test(host) || PRIVATE_NAME.test(host)) return null;
  return host;
}

/** What the person typed as the website. https only, and only a public address. */
export function parseStartUrl(input: string): { url: string; host: string } | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = publicHost(u.hostname);
  return host ? { url: u.toString(), host } : null;
}

/** The site a task may use: the host without "www.", which also covers its subdomains. */
export const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, '');

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * The host from the text in the browser's address bar, or null when there isn't a normal web
 * address there (a blank tab, chrome://, an IP address). Null stops the task: unknown is not safe.
 */
export function addressHost(address: string): string | null {
  const a = address.trim().replace(/^not secure\s*[|·-]?\s*/i, '');
  if (!a || /\s/.test(a)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(a);
  if (scheme && !['http', 'https'].includes(scheme[1]!.toLowerCase())) return null;
  if (!scheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(a)) return null; // about:blank and friends
  const rest = scheme ? a.slice(scheme[0].length) : a;
  return publicHost(rest.split(/[/?#:]/)[0] ?? '');
}

/** What the model may propose for the next step. Every field is checked again below. */
export const StepDecision = z.object({
  see: z.string().max(400),
  action: z.enum([
    'click',
    'type',
    'key',
    'scroll',
    'navigate',
    'wait',
    'done',
    'login',
    'ask',
    'stuck',
  ]),
  /** Click position, 0-1000 across and down the screenshot. */
  x: z.number().nullish(),
  y: z.number().nullish(),
  text: z.string().max(2000).nullish(),
  key: z.string().max(30).nullish(),
  direction: z.enum(['up', 'down']).nullish(),
  url: z.string().max(2000).nullish(),
  /** done: what happened. ask: the question. login, stuck: why. */
  message: z.string().max(600).nullish(),
});
export type StepDecision = z.infer<typeof StepDecision>;

/** What is under a click, read from a small crop around it. */
export const ControlRead = z.object({
  label: z.string().max(200),
  kind: z.enum([
    'link',
    'field',
    'secret_field',
    'choice',
    'expand',
    'search',
    'commit',
    'unclear',
  ]),
});
export type ControlRead = z.infer<typeof ControlRead>;

/**
 * Words that make a control something the person approves first, whatever the model called it.
 * A false match only costs one tap; a miss could cost money, so the list is deliberately wide.
 */
const COMMIT_WORDS =
  /\b(pay|payment|pay now|purchase|buy|order|checkout|check\s*out|submit|send|confirm|delete|remove|cancel|book|reserve|renew|sign(?!\s*(in|out)\b)|agree|accept|apply|publish|post|donate|transfer|subscribe|unsubscribe|register|enrol|enroll|authori[sz]e|finish|complete|place|save|update|continue to pay)\b/i;

export type ClickVerdict = 'go' | 'approve' | 'secret';

/** Whether a click happens now, waits for the person, or is left to the person entirely. */
export function clickVerdict(control: ControlRead): ClickVerdict {
  if (control.kind === 'secret_field') return 'secret';
  if (control.kind === 'commit' || control.kind === 'unclear') return 'approve';
  if (!control.label.trim() || COMMIT_WORDS.test(control.label)) return 'approve';
  return 'go';
}

/** Keys that move around a page. Enter and Space are absent: they can submit or press things. */
const KEYS: Record<string, string> = {
  escape: 'Escape',
  arrowup: 'Up',
  up: 'Up',
  arrowdown: 'Down',
  down: 'Down',
  arrowleft: 'Left',
  left: 'Left',
  arrowright: 'Right',
  right: 'Right',
  pageup: 'Page_Up',
  page_up: 'Page_Up',
  pagedown: 'Page_Down',
  page_down: 'Page_Down',
};
export const safeKey = (key: string | null | undefined) =>
  key ? (KEYS[key.toLowerCase().replace(/\s/g, '')] ?? null) : null;

/** Model coordinates (0-1000) as screen pixels, or null when outside the web page. */
export function clickPoint(
  x: number | null | undefined,
  y: number | null | undefined,
): [number, number] | null {
  if (x == null || y == null || x < 0 || x > 1000 || y < 0 || y > 1000) return null;
  const px = Math.min(FRAME.width - 1, Math.round((x / 1000) * FRAME.width));
  const py = Math.round((y / 1000) * FRAME.height);
  return py < PAGE_AREA.top || py > PAGE_AREA.bottom ? null : [px, py];
}

/** The small area around a click, used to read the control and to spot a page that changed. */
export function controlRegion([x, y]: [number, number]): Region {
  const halfW = 170;
  const halfH = 60;
  return [
    Math.max(0, x - halfW),
    Math.max(PAGE_AREA.top, y - halfH),
    Math.min(FRAME.width, x + halfW),
    Math.min(PAGE_AREA.bottom + 1, y + halfH),
  ];
}

/** Text to type: one line, no control characters, so it can never press Enter. */
export function cleanTyped(text: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const t = (text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return t && t.length <= LIMITS.maxTyped ? t : null;
}

/** The same action three times in a row means it isn't working. */
export function goingInCircles(signatures: string[], next: string): boolean {
  return signatures.length >= 2 && signatures.slice(-2).every((s) => s === next);
}
