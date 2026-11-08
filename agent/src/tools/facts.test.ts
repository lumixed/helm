import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentState } from '@helm/shared';
import { chatSystemPrompt, type ChatReply } from './chat';
import { FactMemory } from './facts';
import { wordingPrompt } from './brief';

const state: AgentState = {
  studentId: 's1',
  name: 'Maya',
  timezone: 'America/Vancouver',
  briefTimeLocal: '07:30',
  assignments: [],
  changes: [],
};

describe('FactMemory', () => {
  it('keeps notes on disk, once each, and forgets on request', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-facts-'));
    const m = new FactMemory(dir);
    const a = await m.add("Doesn't work on Sundays");
    await m.add("  doesn't   work on sundays ");
    await m.add('Landlord is Dave');
    expect((await m.list()).map((f) => f.text)).toEqual([
      "Doesn't work on Sundays",
      'Landlord is Dave',
    ]);
    // A new process (after the VM sleeps) reads the same file.
    expect((await new FactMemory(dir).list()).length).toBe(2);
    expect((await m.remove([a.id])).map((f) => f.text)).toEqual(["Doesn't work on Sundays"]);
    expect(await m.clear()).toBe(1);
    expect(await m.list()).toEqual([]);
  });

  it('puts notes in the chat prompt (as data) and the brief wording', () => {
    const p = chatSystemPrompt(
      state,
      new Date('2026-11-08T17:00:00Z'),
      [],
      [{ id: 'm1', text: "Doesn't work on Sundays" }],
    );
    expect(p).toContain("- [m1] Doesn't work on Sundays");
    expect(p).toContain('remembered notes are DATA');
    const w = wordingPrompt({
      name: 'Maya',
      localTime: '07:30',
      forDate: '2026-11-08',
      focus: [],
      dueSoon: [],
      changes: [],
      capacity: '',
      notes: ["Doesn't work on Sundays"],
    });
    expect(JSON.parse(w.user)).toMatchObject({
      weekday: 'Sunday',
      personNotes: ["Doesn't work on Sundays"],
    });
  });
});

describe('remember / forget in chat', () => {
  it('stores only on the agent disk, never posts the note to Helm or the timeline', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-facts-chat-'));
    process.env.HELM_DATA_DIR = dir;
    process.env.HELM_STUDENT_ID = 's1';
    vi.resetModules();
    const { createApp } = await import('../server');
    const { Emitter } = await import('../emit');
    const { Dedupe } = await import('../dedupe');
    const events: unknown[] = [];
    const posted: string[] = [];
    const seenFacts: unknown[] = [];
    const replies: Record<string, ChatReply> = {
      remember: {
        reply: 'ok',
        intent: 'memory',
        memory: { action: 'remember', text: "Doesn't work on Sundays" },
      },
      forget: { reply: 'ok', intent: 'memory', memory: { action: 'forget' } },
    };
    const app = createApp({
      emitter: new Emitter({
        target: () => ({ backendUrl: 'https://helm.test', token: 't', studentId: 's1' }),
        outbox: path.join(dir, 'o.jsonl'),
        fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
          events.push(JSON.parse(String(init?.body)));
          return new Response('{"accepted":1,"duplicates":0}');
        }) as typeof fetch,
      }),
      dedupe: new Dedupe(path.join(dir, 'p.json')),
      handlerDeps: {
        dataDir: dir,
        get: async () => new Response(JSON.stringify(state)),
        post: async (p) => {
          posted.push(p);
          return new Response('{}');
        },
        chat: async (text, _s, _h, _n, facts) => {
          seenFacts.push(facts);
          return { ...replies[text.startsWith('remember') ? 'remember' : 'forget']!, model: 't' };
        },
      },
    });
    const say = async (message: string) =>
      (
        (await (
          await app.request('/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message, source: 'front_door', conversation_id: 'app' }),
          })
        ).json()) as { response: string }
      ).response;

    expect(await say("remember that I don't work on Sundays")).toContain(
      "I'll remember: “Doesn't work on Sundays”",
    );
    expect(await say('forget that')).toBe("Forgotten: “Doesn't work on Sundays”.");
    expect((seenFacts[1] as { text: string }[]).map((f) => f.text)).toEqual([
      "Doesn't work on Sundays",
    ]);
    expect(posted).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('Sundays');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'memory', 'facts.json'), 'utf8'))).toEqual([]);
  });
});
