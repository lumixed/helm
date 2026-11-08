/**
 * Runs INSIDE a throwaway Maritime sandbox (PRD v2 WP-6): reads one untrusted document and prints
 * one JSON line on stdout. The sandbox has no secrets and is deleted with its disk afterwards.
 *   node parse.mjs <file>   ->   {"ok":true,"text":"...","chars":1234}  |  {"ok":false,"error":"..."}
 */
// Sandboxes run Node 18; the PDF reader (pdf.js) uses newer built-ins such as Iterator helpers and
// Promise.withResolvers. Polyfill them for this bundle only.
import 'core-js/actual';
import { DocumentError, readDocumentText } from '../tools/read-document';

const MAX_TEXT = 200_000;

async function main() {
  const file = process.argv[2];
  if (!file) throw new DocumentError('No file given.');
  const text = await readDocumentText(file);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      text: text.slice(0, MAX_TEXT),
      chars: text.length,
      truncated: text.length > MAX_TEXT,
    }),
  );
}

main().catch((err: unknown) => {
  const known = err instanceof DocumentError;
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: known ? err.message : 'The file could not be read.',
      detail: known ? undefined : String(err).slice(0, 300),
    }),
  );
  process.exitCode = known ? 2 : 1;
});
