import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * What the person asked their agent to remember ("I don't work on Sundays", "my landlord is
 * Dave"). Kept ONLY on this agent's private /data disk on Maritime: it survives sleep and
 * restarts, and Helm's servers never receive or store it. Used in chat and in the brief's wording.
 */
export const Fact = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  at: z.string(),
});
export type Fact = z.infer<typeof Fact>;

export const MAX_FACTS = 30;

export class FactMemory {
  constructor(private dir: string) {}

  private get file() {
    return path.join(this.dir, 'facts.json');
  }

  async list(): Promise<Fact[]> {
    try {
      return z.array(Fact).parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch {
      return [];
    }
  }

  private async save(facts: Fact[]) {
    await fs.mkdir(this.dir, { recursive: true });
    // Write then rename, so a VM snapshot mid-write never leaves a half file.
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(facts));
    await fs.rename(tmp, this.file);
  }

  /** Adds a fact (same text twice is kept once). The oldest drops off past MAX_FACTS. */
  async add(text: string, now = new Date()): Promise<Fact> {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    const facts = await this.list();
    const same = facts.find((f) => f.text.toLowerCase() === clean.toLowerCase());
    if (same) return same;
    const fact = { id: `m${randomBytes(3).toString('hex')}`, text: clean, at: now.toISOString() };
    await this.save([...facts, fact].slice(-MAX_FACTS));
    return fact;
  }

  /** Removes the facts with these ids; returns the ones removed. */
  async remove(ids: string[]): Promise<Fact[]> {
    const facts = await this.list();
    const gone = facts.filter((f) => ids.includes(f.id));
    if (gone.length) await this.save(facts.filter((f) => !ids.includes(f.id)));
    return gone;
  }

  async clear(): Promise<number> {
    const n = (await this.list()).length;
    await this.save([]);
    return n;
  }
}
