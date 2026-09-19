/**
 * supabase-js throws a generic "Edge Function returned a non-2xx status code" for any
 * failed invoke — the readable `{ error }` body our functions send back lives on
 * `error.context`, a Fetch `Response`. Unwrap it so the user sees the real reason
 * (e.g. the send-email settings-gate message) instead of the generic wrapper text.
 */
export async function readableInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // Body wasn't JSON — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
