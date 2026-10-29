/** Reject malformed ownership requests before reading or mutating the store. */
export function isValidExclusiveClaim(
  offset: number,
  channelId: string,
  subscriberId: string,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    offset > 0 &&
    typeof channelId === "string" &&
    channelId !== "" &&
    typeof subscriberId === "string" &&
    subscriberId !== ""
  )
}
