// Logger sub-entry: generic, reusable event log and text diagnostic log.
//
// FunnelLog<E> is a validated event bus backed by SQLite (or memory for tests).
// FunnelTextLog is a levelled diagnostic logger with pluggable writers.
// Neither depends on funnel domain types — any app can use them by supplying
// its own event schema and writer.

// Structured event log
export * from "@/logger/funnel-log"
export * from "@/logger/funnel-log-entry"
export * from "@/logger/funnel-log-sink"
export * from "@/logger/funnel-log-sqlite-sink"
export * from "@/logger/funnel-log-memory-sink"

// Text diagnostic log
export * from "@/logger/funnel-text-log"
export * from "@/logger/funnel-text-entry"
export * from "@/logger/funnel-text-writer"
export * from "@/logger/funnel-text-file-writer"
export * from "@/logger/funnel-text-stdout-writer"
