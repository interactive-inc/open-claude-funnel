export type SessionStore = {
  getSessionId(profileId: string): string | null
  setSessionId(profileId: string, sessionId: string): void
  /** Returns true when the session jsonl exists on disk and is non-empty. */
  sessionFileExists(cwd: string, sessionId: string, env: Record<string, string>): boolean
}
