import { z } from 'zod';

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function readBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.infer<T> | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, 'Invalid JSON');
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fail(400, z.prettifyError(parsed.error));
}
