type Props = {
  kind: "channel" | "connector" | "profile"
  name: string
  available: string[]
  nextAction: string
}

/**
 * One error shape for every name-resolution miss: what was asked, what exists,
 * and the command that creates it — so a Claude (or human) can self-correct
 * without a follow-up listing call.
 */
export const notFoundMessage = (props: Props): string => {
  const listed = props.available.length > 0 ? props.available.join(", ") : "none"

  return `${props.kind} "${props.name}" not found (available: ${listed}); to create one: ${props.nextAction}`
}
