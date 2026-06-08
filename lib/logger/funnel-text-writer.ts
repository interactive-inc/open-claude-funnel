import type { FunnelTextEntry } from "@/logger/funnel-text-entry"

/**
 * Plugin port for `FunnelTextLog`. Writers decide where diagnostic
 * records land — stdout, JSONL file, syslog, network, etc. — without the
 * logger having to know about persistence shape.
 *
 * `write` returns `void` on success or an `Error` the logger surfaces via
 * `onWriteError`. Throwing is also tolerated; the logger catches.
 */
export type FunnelTextWriter = {
  write(record: FunnelTextEntry): void | Error
  close?(): void
}
