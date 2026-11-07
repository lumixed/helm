import fs from 'node:fs';
import { paths } from './config';

const MAX_KEYS = 2000;

/**
 * Remembers which requestIds were already handled, on /data so it survives sleep and restarts.
 * All handlers are idempotent on requestId (PRD section 7).
 */
export class Dedupe {
  private keys: string[];
  private set: Set<string>;

  constructor(private file = paths.processed) {
    this.keys = readKeys(file);
    this.set = new Set(this.keys);
  }

  has(key: string): boolean {
    return this.set.has(key);
  }

  add(key: string): void {
    if (this.set.has(key)) return;
    this.keys.push(key);
    this.set.add(key);
    if (this.keys.length > MAX_KEYS) {
      for (const k of this.keys.splice(0, this.keys.length - MAX_KEYS)) this.set.delete(k);
    }
    fs.writeFileSync(this.file, JSON.stringify(this.keys));
  }
}

function readKeys(file: string): string[] {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}
