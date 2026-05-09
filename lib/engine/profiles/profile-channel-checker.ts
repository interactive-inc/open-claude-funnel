/**
 * Read-side dependency that lets FunnelChannels ask whether a profile
 * references a given channel id, without depending on FunnelProfiles directly.
 */
export type ProfileChannelChecker = {
  hasChannelRef(channelId: string): boolean
}
