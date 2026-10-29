/** Observe host callbacks and thenables without allowing a failing error sink to escape. */
export function invokeCallback(
  callback: () => unknown,
  onError?: (error: unknown) => unknown,
): void {
  const report = (error: unknown): void => {
    try {
      void Promise.resolve(onError?.(error)).catch(() => {})
    } catch {}
  }
  try {
    const returned = callback()
    if (returned !== undefined) void Promise.resolve(returned).catch(report)
  } catch (error) {
    report(error)
  }
}
