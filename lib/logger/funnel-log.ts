import type { EventLogEntry } from "@/event-log/event-log-entry"
import { EventLog, type EventLogProps, type EventLogValidator } from "@/event-log/event-log"

export type FunnelLogValidator<E> = EventLogValidator<E>

export class FunnelLog<E> extends EventLog<E> {
  constructor(props: EventLogProps<E>) {
    super(props)
  }

  emit(event: E): EventLogEntry<E> | Error {
    return this.append(event)
  }
}
