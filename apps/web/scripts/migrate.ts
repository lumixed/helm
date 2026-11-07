// Applies drizzle/ migrations to DATABASE_URL. Runs in the Vercel build (see package.json).
import { connect, migrateDb } from '../src/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('[migrate] DATABASE_URL not set; skipping (local dev uses PGlite).');
  process.exit(0);
}
const db = await connect(url);
await migrateDb(db, url.startsWith('pglite:') ? 'pglite' : 'postgres');
console.log('[migrate] done');
process.exit(0);
