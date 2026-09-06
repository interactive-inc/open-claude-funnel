export const docsChannels = `funnel docs channels — what a channel is

A channel is a subscription mailbox. It owns connectors and decides how events
fan out to subscribers.

shape:

  { id, name, delivery, connectors[] }

delivery modes:

  fanout      every subscriber receives every event. Use when each subscriber
              has its own job (multiple profiles processing the same source,
              observer clients tapping in).
  exclusive   one event goes to one subscriber, round-robin. Use when
              subscribers are interchangeable workers. Reconnect with the same
              id and since offset to replay only that worker's assigned events.
              Events queued without a worker are claimed by the first eligible
              reconnecting worker. MCP keeps the same id across reconnects.

Exclusive replay requires id; anonymous workers receive live events only.
Assignments survive gateway restarts. Older events without an assignment record
are not replayed to exclusive workers because their previous recipient is unknown.
Replay may repeat an event to the same worker; external side effects still need
their own deduplication. Replay stores full content; old truncated rows cannot be
recovered. Connector renames and delivery changes apply on the next live emit.
Publishing to an unknown channel returns HTTP 404 or throws FunnelChannelNotFoundError.

what a channel does NOT own:
  - launch options (those live on Profile)
  - sessions (those live on Profile)
  - tokens (those live in per-repo settings)

operations:

  fnl channels                            list channels
  fnl channels <name>                     show one channel
  fnl channels add <name>                 create a channel
  fnl channels remove <name>              delete a channel
  fnl channels rename <old> <new>         rename a channel
  fnl channels <name> set delivery <mode> change delivery to fanout|exclusive
  fnl channels <name> publish             publish a synthetic event
  fnl channels <name> validate            sanity-check a channel

connectors live nested inside a channel — see fnl docs connectors.

related: fnl docs connectors, fnl docs profiles`
