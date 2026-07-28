import type { EventJournalRecord } from "@/event-journal/event-journal-record"
import {
  EventJournal,
  type EventJournalProps,
  type EventJournalValidator,
} from "@/event-journal/event-journal"

export type FunnelLogValidator<E> = EventJournalValidator<E>

export class FunnelLog<E> extends EventJournal<E> {
  constructor(props: EventJournalProps<E>) {
    super(props)
  }

  emit(event: E): EventJournalRecord<E> | Error {
    return this.append(event)
  }
}
