/**
 * Streaming response reader with a byte cap.
 *
 * Extracted from `app/api/proxy/route.ts` so the truncation logic can be
 * unit-tested without spinning up Next.js. The proxy route uses this to
 * read an upstream fetch body while enforcing the 5 MB response cap and
 * cancelling the upstream reader as soon as the cap is reached.
 *
 * Behaviour:
 *   - Reads chunks until the stream ends OR the cap is reached.
 *   - On cap: keeps the partial chunk that fits, marks truncated = true,
 *     cancels the reader (best-effort) and releases the lock.
 *   - Returns the concatenated Buffer plus total size and truncation flag.
 *
 * Caller responsibility: encoding (utf8/base64) is NOT done here — the
 * caller decides based on content-type. This keeps the helper pure.
 */

export interface StreamCapResult {
  body: Buffer
  size: number
  truncated: boolean
}

export async function readWithCap(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<StreamCapResult> {
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const remaining = maxBytes - received
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining))
          received += remaining
        }
        truncated = true
        try {
          await reader.cancel()
        } catch {
          /* cancel may throw if stream already closed — ignore */
        }
        break
      }

      chunks.push(value)
      received += value.byteLength
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released — ignore */
    }
  }

  const body = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  return { body, size: body.byteLength, truncated }
}
