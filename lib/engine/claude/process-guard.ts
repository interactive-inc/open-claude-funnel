export type ProcessGuard = {
  /** Returns true if a live process is already registered for this profile. */
  isRunning(profileId: string): boolean
  /** Writes the PID file and registers an exit hook to clean it up. */
  acquire(profileId: string): void
  /** Removes the PID file. */
  release(profileId: string): void
}
