import { Database } from "bun:sqlite"

/** Keeps the first worker assignment stable across gateway restarts. */
export class SqliteExclusiveClaims {
  private readonly database: Database

  constructor(path: string) {
    this.database = new Database(path)
    this.database.run("PRAGMA journal_mode = WAL")
    this.database.run(`CREATE TABLE IF NOT EXISTS funnel_exclusive_claims (
      offset INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      subscriber_id TEXT NOT NULL,
      PRIMARY KEY (offset, channel_id)
    )`)
  }

  claim(offset: number, channelId: string, subscriberId: string): boolean {
    this.database
      .query(`INSERT OR IGNORE INTO funnel_exclusive_claims
      (offset, channel_id, subscriber_id) VALUES (?, ?, ?)`)
      .run(offset, channelId, subscriberId)
    const owner = this.database
      .query<{ subscriber_id: string }, [number, string]>(
        "SELECT subscriber_id FROM funnel_exclusive_claims WHERE offset = ? AND channel_id = ?",
      )
      .get(offset, channelId)

    return owner?.subscriber_id === subscriberId
  }

  pruneBefore(offset: number): void {
    this.database.query("DELETE FROM funnel_exclusive_claims WHERE offset < ?").run(offset)
  }

  clear(): void {
    this.database.run("DELETE FROM funnel_exclusive_claims")
  }

  close(): void {
    this.database.close()
  }
}
