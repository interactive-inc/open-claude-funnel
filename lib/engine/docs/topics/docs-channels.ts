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
              subscribers are interchangeable workers and each event must be
              processed exactly once.

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
