import path from 'node:path';
import * as schema from './schema';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __helmDb?: Promise<Db> };

/**
 * Production: Neon (or any Postgres) via DATABASE_URL.
 * Local dev and tests: an embedded PGlite database when DATABASE_URL is unset or "pglite:<dir>".
 */
export function getDb(): Promise<Db> {
  return (g.__helmDb ??= connect(process.env.DATABASE_URL));
}

export async function connect(url: string | undefined): Promise<Db> {
  if (!url || url.startsWith('pglite:')) {
    if (process.env.VERCEL) throw new Error('DATABASE_URL must be set on Vercel');
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const dir = url?.slice('pglite:'.length) || undefined; // undefined = in-memory
    const db = drizzle(new PGlite(dir), { schema }) as unknown as Db;
    await migrateDb(db, 'pglite');
    return db;
  }
  const postgres = (await import('postgres')).default;
  // prepare:false keeps it compatible with Neon's pooled (PgBouncer) endpoint.
  const client = postgres(url, {
    prepare: false,
    max: process.env.VERCEL ? 1 : 5,
    onnotice: () => {},
  });
  return drizzlePg(client, { schema }) as unknown as Db;
}

// apps/web is the working directory for next dev/build, vitest and the migrate script.
const MIGRATIONS = path.join(process.cwd(), 'drizzle');

export async function migrateDb(db: Db, kind: 'pglite' | 'postgres') {
  if (kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as never, { migrationsFolder: process.env.HELM_MIGRATIONS_DIR ?? MIGRATIONS });
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db as never, { migrationsFolder: process.env.HELM_MIGRATIONS_DIR ?? MIGRATIONS });
  }
}
