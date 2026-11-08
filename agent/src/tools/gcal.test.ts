import { describe, expect, it } from 'vitest';
import { addBlocks, blockEventId, listEvents } from './gcal';

const block = {
  assignmentId: 'a1',
  title: 'Lab report',
  start: '2026-11-10T17:00:00.000Z',
  end: '2026-11-10T18:00:00.000Z',
};

describe('addBlocks', () => {
  it('uses a stable, Google-valid event id, so a second tap adds nothing', async () => {
    const id = await blockEventId(block);
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(await blockEventId({ ...block })).toBe(id);
    expect(await blockEventId({ ...block, start: '2026-11-10T19:00:00.000Z' })).not.toBe(id);

    const seen = new Set<string>();
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      const eid = (JSON.parse(String(init?.body)) as { id: string }).id;
      if (seen.has(eid)) return new Response('{}', { status: 409 });
      seen.add(eid);
      return new Response('{}');
    }) as typeof fetch;
    expect(await addBlocks('t', [block], null, f)).toEqual({ added: 1, existing: 0 });
    expect(await addBlocks('t', [block], null, f)).toEqual({ added: 0, existing: 1 });
  });

  it('marks the event as Helm’s and surfaces a missing permission', async () => {
    let body: Record<string, unknown> = {};
    const ok = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{}');
    }) as typeof fetch;
    await addBlocks('t', [block], 'https://helm.test', ok);
    expect(body).toMatchObject({
      summary: 'Focus: Lab report',
      extendedProperties: { private: { helm: 'block' } },
    });
    const denied = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(addBlocks('t', [block], null, denied)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('listEvents', () => {
  it('leaves out Helm’s own blocks so they are not planned around', async () => {
    const f = (async () =>
      Response.json({
        items: [
          {
            summary: 'Focus: Lab report',
            start: { dateTime: block.start },
            end: { dateTime: block.end },
            extendedProperties: { private: { helm: 'block' } },
          },
          { summary: 'Dentist', start: { dateTime: block.start }, end: { dateTime: block.end } },
        ],
      })) as unknown as typeof fetch;
    const events = await listEvents('t', block.start, block.end, f);
    expect(events.map((e) => e.title)).toEqual(['Dentist']);
  });
});
