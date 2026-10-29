/** Own the body reader so shutdown can release a stalled incoming stream. */
export async function readRequestText(request: Request, signal: AbortSignal): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) {
    signal.throwIfAborted()
    return ""
  }
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener("abort", cancel, { once: true })
  let complete = false
  try {
    if (signal.aborted) cancel()
    signal.throwIfAborted()
    const decoder = new TextDecoder()
    const chunks: string[] = []
    while (true) {
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) {
        complete = true
        break
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join("")
  } finally {
    signal.removeEventListener("abort", cancel)
    if (!complete) cancel()
    reader.releaseLock()
  }
}
