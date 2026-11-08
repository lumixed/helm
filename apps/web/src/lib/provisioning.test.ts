import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import { hashAgentToken } from './agent-auth';
import {
  MaritimeError,
  type CreateAgentInput,
  type MaritimeClient,
  type MaritimeAgentStatus,
} from './maritime';
import { deleteStudent, ensureStudentAgent, refreshAgent } from './provisioning';

const env = {
  appBaseUrl: 'https://helm.test',
  agentImage: 'ghcr.io/x/agent@sha256:abc',
  geminiApiKey: 'g-key',
  demoMode: true,
};

function fakeMaritime() {
  const state = {
    endUsers: new Map<string, unknown>(),
    agents: new Map<
      string,
      { id: string; externalId: string; status: MaritimeAgentStatus; input: CreateAgentInput }
    >(),
    files: new Map<string, string>(),
    network: new Map<string, string[]>(),
    env: new Map<string, { value: string; secret: boolean }>(),
    reloads: 0,
    creates: 0,
  };
  const client: MaritimeClient = {
    async upsertEndUser(id, body) {
      state.endUsers.set(id, body);
    },
    async createEndUserAgent(externalId, input) {
      state.creates++;
      const found = [...state.agents.values()].find((a) => a.externalId === externalId);
      if (found)
        return {
          agent: { id: found.id, name: externalId, status: found.status, externalId },
          created: false,
        };
      const a = {
        id: `mt_${state.agents.size + 1}`,
        externalId,
        status: 'deploying' as MaritimeAgentStatus,
        input,
      };
      state.agents.set(a.id, a);
      return { agent: { id: a.id, name: externalId, status: a.status, externalId }, created: true };
    },
    async listAgents() {
      return [
        {
          id: 'r1',
          name: 'helm-image-v0-3',
          status: 'sleeping' as const,
          externalId: null,
          imageName: 'img@sha256:old',
          createdAt: '2026-11-07T21:00:00Z',
        },
        {
          id: 'r2',
          name: 'helm-image-v0-4',
          status: 'active' as const,
          externalId: null,
          imageName: 'img@sha256:new',
          createdAt: '2026-11-07T22:00:00Z',
        },
        {
          id: 'r3',
          name: 'user_x',
          status: 'active' as const,
          externalId: 'user_x',
          imageName: 'img@sha256:other',
          createdAt: '2026-11-07T23:00:00Z',
        },
      ];
    },
    async getAgent(id) {
      const a = state.agents.get(id);
      if (!a) throw new MaritimeError(404, 'not found', `/api/agents/${id}`);
      return { id, name: a.externalId, status: a.status, externalId: a.externalId };
    },
    async getNetwork() {
      return { internet: { mode: 'all' as const, presetId: null, allow: [], deny: [] } };
    },
    async putNetwork(id, body) {
      state.network.set(id, body.internet.allow);
      return { internet: { ...body.internet, presetId: null } };
    },
    async setEnv(id, key, value, secret) {
      state.env.set(`${id}:${key}`, { value, secret });
    },
    async reloadEnv() {
      state.reloads++;
    },
    async mintToken(ext) {
      return { token: `eu_test_${ext}`, agentId: 'mt_1', expiresAt: '2026-11-08T00:15:00Z' };
    },
    async deleteEnv(id, key) {
      state.env.delete(`${id}:${key}`);
    },
    async testNetwork(_id, destination) {
      return { destination, reached: false, reason: 'Refused by the internet policy.' };
    },
    async listWebhooks() {
      return [];
    },
    async createWebhook() {
      return { id: 'wh', secret: 's' };
    },
    async deleteWebhook() {},
    async mkdir() {},
    async uploadFile() {},
    async writeFile(id, path, content) {
      state.files.set(`${id}:${path}`, content);
    },
    async webhookToken() {
      return 'wh';
    },
    async invokeWebhook() {},
    async setPolicy() {},
    async deleteEndUser(id) {
      for (const [k, a] of state.agents) if (a.externalId === id) state.agents.delete(k);
      state.endUsers.delete(id);
    },
  };
  return { client, state };
}

let db: Db;
let user: User;

beforeEach(async () => {
  db = await connect(undefined);
  [user] = (await db
    .insert(schema.users)
    .values({ email: 'maya@example.edu', name: 'Maya', briefTimeLocal: '08:00' })
    .returning()) as [User];
});

describe('ensureStudentAgent', () => {
  it('creates one agent with secrets seeded as encrypted env', async () => {
    const { client, state } = fakeMaritime();
    const row = await ensureStudentAgent(db, user, client, env);
    expect(row.maritimeAgentId).toBe('mt_1');
    expect(row.status).toBe('provisioning');

    const seeded = state.agents.get('mt_1')!.input;
    expect(seeded.imageName).toBe(env.agentImage);
    const byKey = Object.fromEntries(seeded.initialEnvVars!.map((e) => [e.key, e]));
    expect(byKey.HELM_STUDENT_ID?.value).toBe(user.id);
    expect(byKey.HELM_BACKEND_URL?.value).toBe('https://helm.test');
    expect(byKey.HELM_AGENT_TOKEN?.isSecret).toBe(true);
    expect(byKey.GEMINI_API_KEY).toMatchObject({ value: 'g-key', isSecret: true });
    // Only the hash is stored, and it matches the seeded token.
    expect(row.agentTokenHash).toBe(hashAgentToken(byKey.HELM_AGENT_TOKEN!.value));
  });

  it('is idempotent across repeated sign-ins', async () => {
    const { client, state } = fakeMaritime();
    const a = await ensureStudentAgent(db, user, client, env);
    const b = await ensureStudentAgent(db, user, client, env);
    expect(b.id).toBe(a.id);
    expect(state.creates).toBe(1);
    expect(await db.select().from(schema.agents)).toHaveLength(1);
  });

  it('two students get two distinct agents', async () => {
    const { client } = fakeMaritime();
    const [other] = (await db
      .insert(schema.users)
      .values({ email: 'li@example.edu' })
      .returning()) as [User];
    const a = await ensureStudentAgent(db, user, client, env);
    const b = await ensureStudentAgent(db, other, client, env);
    expect(a.maritimeAgentId).not.toBe(b.maritimeAgentId);
  });

  it('records a readable error when Maritime refuses', async () => {
    const { client } = fakeMaritime();
    client.createEndUserAgent = async () => {
      throw new MaritimeError(402, 'trial_required', '/x');
    };
    const row = await ensureStudentAgent(db, user, client, env);
    expect(row.status).toBe('error');
    expect(row.lastError).toMatch(/billing/);
    // A retry after the problem is fixed works and keeps one row.
    const ok = fakeMaritime();
    const again = await ensureStudentAgent(db, user, ok.client, env);
    expect(again.maritimeAgentId).toBe('mt_1');
  });

  it('flags an agent that already existed at Maritime with an unknown token', async () => {
    const { client } = fakeMaritime();
    await client.createEndUserAgent(`user_${user.id}`, {});
    const row = await ensureStudentAgent(db, user, client, env);
    expect(row.status).toBe('error');
    expect(row.lastError).toMatch(/older token/);
  });
});

describe('MARITIME_AGENT_IMAGE=auto', () => {
  it('uses the newest helm-image-* release', async () => {
    const { client, state } = fakeMaritime();
    await ensureStudentAgent(db, user, client, { ...env, agentImage: 'auto' });
    expect(state.agents.get('mt_1')!.input.imageName).toBe('img@sha256:new');
  });
});

describe('refreshAgent', () => {
  it('maps status and writes the settings file once ready', async () => {
    const { client, state } = fakeMaritime();
    await ensureStudentAgent(db, user, client, env);
    state.agents.get('mt_1')!.status = 'active';
    const row = await refreshAgent(db, user, client);
    expect(row?.status).toBe('ready');
    expect(row?.configWrittenAt).toBeInstanceOf(Date);
    const file = JSON.parse(state.files.get('mt_1:/data/helm/config.json')!);
    expect(file).toMatchObject({ v: 1, briefTime: '08:00', timezone: 'America/Vancouver' });
    expect(JSON.stringify(file)).not.toMatch(/token/i);
  });

  it('re-sends settings when the app URL changes, and not otherwise', async () => {
    const { client, state } = fakeMaritime();
    process.env.APP_BASE_URL = 'https://wrong.example';
    await ensureStudentAgent(db, user, client, env);
    state.agents.get('mt_1')!.status = 'active';
    await refreshAgent(db, user, client);
    const read = () => JSON.parse(state.files.get('mt_1:/data/helm/config.json')!);
    expect(read().backendUrl).toBe('https://wrong.example');

    let writes = 0;
    const orig = client.writeFile;
    client.writeFile = async (...a) => {
      writes++;
      return orig(...a);
    };
    await refreshAgent(db, user, client);
    expect(writes).toBe(0); // unchanged settings are not re-sent

    process.env.APP_BASE_URL = 'https://helm.test/';
    await refreshAgent(db, user, client);
    expect(writes).toBe(1);
    expect(read().backendUrl).toBe('https://helm.test');
    delete process.env.APP_BASE_URL;
  });
});

describe('egress allowlist', () => {
  it('is applied once the agent is up, and only once', async () => {
    const { client, state } = fakeMaritime();
    process.env.APP_BASE_URL = 'https://helm.test';
    await ensureStudentAgent(db, user, client, env);
    state.agents.get('mt_1')!.status = 'active';
    await refreshAgent(db, user, client);
    expect(state.network.get('mt_1')).toEqual([
      '*.instructure.com',
      '*.sb.mtm.sh',
      'generativelanguage.googleapis.com',
      'helm.test',
    ]);
    state.network.clear();
    await refreshAgent(db, user, client);
    expect(state.network.size).toBe(0);
    delete process.env.APP_BASE_URL;
  });
});

describe('deleteStudent', () => {
  it('removes the Maritime end user and all Helm rows', async () => {
    const { client, state } = fakeMaritime();
    await ensureStudentAgent(db, user, client, env);
    await deleteStudent(db, user.id, client);
    expect(state.agents.size).toBe(0);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, user.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(schema.agents)).toHaveLength(0);
  });
});

describe('demo-portal login (WP-0.5)', () => {
  it('goes in as encrypted env at creation', async () => {
    process.env.APP_BASE_URL = 'https://helm.test';
    process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';
    const { client, state } = fakeMaritime();
    const row = await ensureStudentAgent(db, user, client, env);
    const byKey = Object.fromEntries(
      state.agents.get('mt_1')!.input.initialEnvVars!.map((e) => [e.key, e]),
    );
    expect(byKey.PORTAL_URL?.value).toBe('https://helm.test/mock-portal');
    expect(byKey.PORTAL_USERNAME).toMatchObject({ value: user.id, isSecret: true });
    expect(byKey.PORTAL_PASSWORD?.isSecret).toBe(true);
    expect(row.portalEnvAt).not.toBeNull();
    delete process.env.APP_BASE_URL;
  });

  it('is added once to agents created before M7', async () => {
    process.env.APP_BASE_URL = 'https://helm.test';
    process.env.AUTH_SECRET ??= 'test-secret-test-secret-123';
    const { client, state } = fakeMaritime();
    await ensureStudentAgent(db, user, client, env);
    await db.update(schema.agents).set({ portalEnvAt: null });
    state.agents.get('mt_1')!.status = 'active';
    await refreshAgent(db, user, client);
    expect(state.env.get('mt_1:PORTAL_PASSWORD')?.secret).toBe(true);
    expect(state.reloads).toBe(1);
    await refreshAgent(db, user, client);
    expect(state.reloads).toBe(1);
    delete process.env.APP_BASE_URL;
  });
});
