import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentError, readDocumentText, resolveInside } from './read-document';

const fx = (f: string) => path.join(import.meta.dirname, '../../fixtures/syllabi', f);

describe('readDocumentText', () => {
  it('reads PDF', async () => {
    const t = await readDocumentText(fx('data210.pdf'));
    expect(t).toMatch(/Assignment 2: Stacks and queues/);
    expect(t).toMatch(/December 3 at 11:59 pm/);
  });
  it('reads DOCX', async () => {
    const t = await readDocumentText(fx('engl150.docx'));
    expect(t).toMatch(/Essay 1, "A Place I Know"/);
  });
  it('reads TXT', async () => {
    expect(await readDocumentText(fx('engl150.txt'))).toMatch(/Final reflection/);
  });
  it('explains unsupported, empty and missing files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-'));
    fs.writeFileSync(path.join(dir, 'a.pptx'), 'x'.repeat(100));
    fs.writeFileSync(path.join(dir, 'empty.txt'), '');
    await expect(readDocumentText(path.join(dir, 'a.pptx'))).rejects.toThrow(/PDF, DOCX and TXT/);
    await expect(readDocumentText(path.join(dir, 'empty.txt'))).rejects.toThrow(/empty/);
    await expect(readDocumentText(path.join(dir, 'nope.pdf'))).rejects.toBeInstanceOf(
      DocumentError,
    );
  });
});

describe('resolveInside', () => {
  it('allows files under the data dir and maps /data/ paths in dev', () => {
    expect(resolveInside('/data', '/data/inbox/s.pdf')).toBe('/data/inbox/s.pdf');
    expect(resolveInside('/tmp/x', '/data/inbox/s.pdf')).toBe('/tmp/x/inbox/s.pdf');
  });
  it('refuses traversal and outside paths', () => {
    expect(resolveInside('/data', '/data/../etc/passwd')).toBeNull();
    expect(resolveInside('/data', '/etc/passwd')).toBeNull();
    expect(resolveInside('/data', '/data')).toBeNull();
  });
});
