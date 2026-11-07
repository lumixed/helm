import type { z } from 'zod';

/**
 * Gemini through its OpenAI-compatible endpoint (Bearer auth, JSON-schema structured output).
 * Models are tried in order: Gemini is sometimes overloaded (503) or slow, which must not break
 * a demo. Each call is bounded so the agent never hangs on one model.
 */
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
// Order measured 2026-11-07 on the syllabus eval: 3.6-flash ~18 s and 15/15 correct; 3.5-flash
// intermittently 503; 3.8-flash (Google's recommended model) timed out under load that day.
// Override per agent with GEMINI_MODEL (comma-separated).
export const DEFAULT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

export interface GeminiOptions {
  apiKey: string;
  models?: string[];
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly attempts: string[],
  ) {
    super(message);
  }
}

export interface JsonCallResult<T> {
  data: T;
  model: string;
  attempts: string[];
}

export async function geminiJson<T>(
  opts: GeminiOptions,
  req: { system: string; user: string; schemaName: string; jsonSchema: object; zod: z.ZodType<T> },
): Promise<JsonCallResult<T>> {
  const models = opts.models?.length ? opts.models : DEFAULT_MODELS;
  const attempts: string[] = [];
  for (const model of models) {
    let feedback: string | null = null;
    // One retry per model with the validation error (PRD section 7, failure behaviour).
    for (let round = 0; round < 2; round++) {
      const messages = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
        ...(feedback
          ? [
              {
                role: 'user',
                content: `Your previous JSON was invalid: ${feedback}\nReturn corrected JSON only.`,
              },
            ]
          : []),
      ];
      let res: Response;
      try {
        res = await (opts.fetch ?? fetch)(`${GEMINI_BASE}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages,
            response_format: {
              type: 'json_schema',
              json_schema: { name: req.schemaName, schema: req.jsonSchema },
            },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 40_000),
        });
      } catch (err) {
        attempts.push(`${model}: ${String(err).slice(0, 120)}`);
        break; // timeout or network: next model
      }
      const text = await res.text();
      if (!res.ok) {
        attempts.push(`${model}: HTTP ${res.status} ${errorMessage(text)}`);
        break; // 503 overload, 404 retired model, ...: next model
      }
      const content = contentOf(text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content ?? '');
      } catch {
        feedback = 'not valid JSON';
        attempts.push(`${model}: invalid JSON`);
        continue;
      }
      const result = req.zod.safeParse(parsed);
      if (result.success) return { data: result.data, model, attempts };
      feedback = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      attempts.push(`${model}: schema mismatch (${feedback.slice(0, 120)})`);
    }
  }
  throw new LlmError(`All Gemini models failed: ${attempts.join(' | ')}`, attempts);
}

function contentOf(body: string): string | null {
  try {
    const j = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function errorMessage(body: string): string {
  try {
    const j: unknown = JSON.parse(body);
    const e = (Array.isArray(j) ? j[0] : j) as { error?: { message?: string } };
    return (e?.error?.message ?? body).slice(0, 120);
  } catch {
    return body.slice(0, 120);
  }
}
