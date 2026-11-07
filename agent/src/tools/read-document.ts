import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class DocumentError extends Error {}

/** Plain text from a syllabus file on the agent's disk: .txt/.md, .pdf or .docx. */
export async function readDocumentText(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new DocumentError('The file was not found on the agent.');
  if (stat.size === 0) throw new DocumentError('The file is empty.');
  if (stat.size > MAX_DOCUMENT_BYTES) throw new DocumentError('The file is larger than 20 MB.');
  const ext = path.extname(filePath).toLowerCase();
  const bytes = await fs.readFile(filePath);

  let text: string;
  if (ext === '.txt' || ext === '.md' || ext === '') {
    text = bytes.toString('utf8');
  } else if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (ext === '.docx') {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    throw new DocumentError(`Helm can read PDF, DOCX and TXT files, not ${ext}.`);
  }
  text = text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (text.length < 40) {
    throw new DocumentError(
      'Helm could not find readable text in this file. If it is a scan, paste the text instead.',
    );
  }
  return text;
}

/** Only files inside the agent's data directory may be read (no path tricks from messages). */
export function resolveInside(root: string, requested: string): string | null {
  const abs = path.resolve(
    root,
    requested.startsWith('/data/') && root !== '/data'
      ? requested.slice('/data/'.length)
      : requested,
  );
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? abs : null;
}
