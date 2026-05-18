import { claudeHelp } from "@/cli/routes/claude"
import type { ChannelSpec, LocalConfig } from "@/engine/local-config/local-config-schema"
import type { LocalConfigSyncResult } from "@/engine/local-config/local-config-sync"
import type { Funnel } from "@/funnel"

export type DispatchClaudeResult = {
  stdout: string | null
  stderr: string | null
  exitCode: number
}

type Deps = {
  funnel: Funnel
  cwd?: string
}

const HELP_LONG = "--help"
const HELP_SHORT = "-h"
const PROFILE_LONG = "--profile"
const PROFILE_SHORT = "-p"
const CHANNEL_LONG = "--channel"

type Parsed = {
  profile: string | null
  channel: string | null
  wantsHelp: boolean
  userArgs: string[]
}

type FlagMatch = { value: string | null; consumed: number }

const takeFlag = (args: string[], i: number, longForm: string, shortForm: string | null): FlagMatch | null => {
  const arg = args[i]

  if (arg === undefined) return null

  if (arg === longForm || (shortForm !== null && arg === shortForm)) {
    const next = args[i + 1]

    if (next !== undefined && !next.startsWith("-")) {
      return { value: next, consumed: 2 }
    }

    return { value: null, consumed: 1 }
  }

  const prefix = `${longForm}=`

  if (arg.startsWith(prefix)) {
    return { value: arg.slice(prefix.length), consumed: 1 }
  }

  return null
}

const parse = (args: string[]): Parsed => {
  const userArgs: string[] = []
  let profile: string | null = null
  let channel: string | null = null
  let wantsHelp = false
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === undefined) break

    if (arg === HELP_LONG || arg === HELP_SHORT) {
      wantsHelp = true
      i++
      continue
    }

    const profileMatch = takeFlag(args, i, PROFILE_LONG, PROFILE_SHORT)

    if (profileMatch) {
      if (profileMatch.value !== null) profile = profileMatch.value
      i += profileMatch.consumed
      continue
    }

    const channelMatch = takeFlag(args, i, CHANNEL_LONG, null)

    if (channelMatch) {
      if (channelMatch.value !== null) channel = channelMatch.value
      i += channelMatch.consumed
      continue
    }

    userArgs.push(arg)
    i++
  }

  return { profile, channel, wantsHelp, userArgs }
}

/**
 * Brings the gateway's listener supervisor in sync with what `ensure()` just
 * wrote to settings.json. Without this, the supervisor keeps running the old
 * snapshot it loaded at daemon startup, so a freshly synced connector never
 * starts (and a stale one never stops) until `fnl gateway restart`. When the
 * daemon is offline every call returns `{ state: "offline" }` and the gateway
 * auto-start inside `claude.launch` will reload from scratch anyway.
 */
const reconcileListeners = async (
  funnel: Funnel,
  channelName: string,
  synced: LocalConfigSyncResult,
): Promise<void> => {
  for (const outcome of synced.touched) {
    if (outcome.changed) {
      await funnel.listeners.restart(channelName, outcome.name)
    } else {
      await funnel.listeners.start(channelName, outcome.name)
    }
  }

  for (const name of synced.removed) {
    await funnel.listeners.stop(channelName, name)
  }
}

const pickChannel = (local: LocalConfig, requestedName: string | null): ChannelSpec | string => {
  if (requestedName === null) {
    const first = local.channels[0]

    if (!first) return `funnel.json declares no channels`

    return first
  }

  const found = local.channels.find((c) => c.name === requestedName)

  if (!found) {
    const available = local.channels.map((c) => c.name).join(", ")

    return `channel "${requestedName}" is not declared in funnel.json (available: ${available})`
  }

  return found
}

/**
 * Entry point for `fnl claude <args>`. Pulls only funnel-specific flags
 * (--profile / -p, --channel, --help / -h) out of argv and forwards every
 * other token verbatim to claude. Channel.options and channel.env (from
 * ~/.funnel/settings.json) are applied by FunnelClaude.launch — this layer
 * only decides which channel to bind.
 *
 * Resolution order:
 *   1. --help → print help
 *   2. --profile <name> → named profile (ignores funnel.json)
 *   3. funnel.json in cwd → select channel (--channel <name> or first), sync, launch
 *   4. --channel <name> with no funnel.json → raw launch against existing settings.json channel
 *   5. default profile → launch
 *   6. nothing matched → print help
 */
export const dispatchClaude = async (
  deps: Deps,
  args: string[],
): Promise<DispatchClaudeResult> => {
  const parsed = parse(args)

  if (parsed.wantsHelp) {
    return { stdout: claudeHelp, stderr: null, exitCode: 0 }
  }

  const funnel = deps.funnel
  const cwd = deps.cwd ?? process.cwd()

  if (parsed.profile !== null) {
    const profile = funnel.profiles.get(parsed.profile)

    if (!profile) {
      return {
        stdout: null,
        stderr: `error: profile "${parsed.profile}" not found`,
        exitCode: 1,
      }
    }

    const exitCode = await funnel.claude.launch({
      channel: profile.channelId,
      cwd: profile.path,
      userArgs: parsed.userArgs,
      profileName: profile.name,
    })

    return { stdout: null, stderr: null, exitCode }
  }

  const local = funnel.localConfig.read(cwd)

  if (local) {
    const picked = pickChannel(local, parsed.channel)

    if (typeof picked === "string") {
      return { stdout: null, stderr: `error: ${picked}`, exitCode: 1 }
    }

    const synced = await funnel.localConfigSync.ensure(picked, cwd)

    await reconcileListeners(funnel, picked.name, synced)

    const exitCode = await funnel.claude.launch({
      channel: picked.name,
      cwd,
      userArgs: parsed.userArgs,
    })

    return { stdout: null, stderr: null, exitCode }
  }

  if (parsed.channel !== null) {
    const exitCode = await funnel.claude.launch({
      channel: parsed.channel,
      cwd,
      userArgs: parsed.userArgs,
    })

    return { stdout: null, stderr: null, exitCode }
  }

  const defaultProfile = funnel.profiles.getDefault()

  if (!defaultProfile) {
    return { stdout: claudeHelp, stderr: null, exitCode: 0 }
  }

  const exitCode = await funnel.claude.launch({
    channel: defaultProfile.channelId,
    cwd: defaultProfile.path,
    userArgs: parsed.userArgs,
    profileName: defaultProfile.name,
  })

  return { stdout: null, stderr: null, exitCode }
}
