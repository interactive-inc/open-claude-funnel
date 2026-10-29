import { encodeSqliteText, SQLITE_TEXT_PARAMETER } from "@/event-log/sqlite-text"
import type { Database } from "bun:sqlite"

/** Keeps the first worker assignment stable across gateway restarts. */
export class SqliteExclusiveClaims {
  constructor(private readonly database: Database) {
    this.database.run(`CREATE TABLE IF NOT EXISTS funnel_exclusive_claims (
      offset INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      subscriber_id TEXT NOT NULL,
      PRIMARY KEY (offset, channel_id)
    )`)
    // Bind claims to a retained row's lifetime, including offset reuse after
    // retention or cleanup failures from an older store implementation.
    this.database.run(`CREATE TRIGGER IF NOT EXISTS funnel_exclusive_claims_insert
      AFTER INSERT ON logs BEGIN
        DELETE FROM funnel_exclusive_claims WHERE offset = NEW.seq;
      END`)
    this.database.run(`CREATE TRIGGER IF NOT EXISTS funnel_exclusive_claims_delete
      AFTER DELETE ON logs BEGIN
        DELETE FROM funnel_exclusive_claims WHERE offset = OLD.seq;
      END`)
  }

  claim(offset: number, channelId: string, subscriberId: string): boolean {
    this.database
      .query(`INSERT OR IGNORE INTO funnel_exclusive_claims
      (offset, channel_id, subscriber_id) VALUES (?, ${SQLITE_TEXT_PARAMETER}, ${SQLITE_TEXT_PARAMETER})`)
      .run(offset, encodeSqliteText(channelId), encodeSqliteText(subscriberId))
    // Bun cannot round-trip unpaired surrogates through a TEXT result row.
    const owner = this.database
      .query<{ owned: number }, [string, number, string]>(
        `SELECT subscriber_id = ${SQLITE_TEXT_PARAMETER} AS owned FROM funnel_exclusive_claims
        WHERE offset = ? AND channel_id = ${SQLITE_TEXT_PARAMETER}`,
      )
      .get(encodeSqliteText(subscriberId), offset, encodeSqliteText(channelId))

    return owner?.owned === 1
  }

  pruneBefore(offset: number): void {
    this.database.query("DELETE FROM funnel_exclusive_claims WHERE offset < ?").run(offset)
  }

  clear(): void {
    this.database.run("DELETE FROM funnel_exclusive_claims")
  }
}
