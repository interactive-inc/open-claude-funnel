import { claudeHelp } from "@/cli/routes/claude"
import type { FunnelClaude } from "@/engine/claude/claude"
import type { ChannelSpec, LocalConfig } from "@/engine/local-config/local-config-schema"
import type { FunnelLocalConfig } from "@/engine/local-config/local-config"
import type { FunnelLocalConfigSync, LocalConfigSyncResult } from "@/engine/local-config/local-config-sync"
import type { FunnelProfiles } from "@/engine/profiles/profiles"
import type { FunnelListenersClient } from "@/gateway/listeners-client"

export type DispatchClaudeResult = {
  stdout: string | null
  stderr: string | null
  exitCode: number
}

export type DispatchDeps = {
  claude: FunnelClaude
  profiles: FunnelProfiles
  localConfig: FunnelLocalConfig
  localConfigSync: FunnelLocalConfigSync
  listeners: FunnelListenersClient
}

type Deps = DispatchDeps & { cwd?: string }

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

const takeFlag = (
  args: string[],
  i: number,
  longForm: string,
  shortForm: string | null,
): FlagMatch | null => {
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
  listeners: FunnelListenersClient,
  channelName: string,
  synced: LocalConfigSyncResult,
): Promise<void> => {
  for (const outcome of synced.touched) {
    if (outcome.changed) {
      await listeners.restart(channelName, outcome.name)
    } else {
      await listeners.start(channelName, outcome.name)
    }
  }

  for (const name of synced.removed) {
    await listeners.stop(channelName, name)
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
 * other token verbatim to claude. The launch recipe (options / env / resume)
 * comes from the resolved profile — global (--profile / default) or a
 * funnel.json profile selected by name (--profile <name>) — and is passed to
 * FunnelClaude.launch. A channel only ever binds transport; it never pulls in
 * a profile on its own.
 *
 * Resolution order:
 *   1. --help → print help
 *   2. --profile + --channel together → error (a profile already binds a channel)
 *   3. --profile <name> → global profile, else the funnel.json profile with that
 *      name (resolves its channel, syncs, applies its recipe)
 *   4. funnel.json in cwd → bind the selected channel's transport only
 *      (--channel <name> or first); no recipe
 *   5. --channel <name> with no funnel.json → raw launch (no recipe)
 *   6. default global profile → launch
 *   7. nothing matched → print help
 */
export const dispatchClaude = async (deps: Deps, args: string[]): Promise<DispatchClaudeResult> => {
  const parsed = parse(args)

  if (parsed.wantsHelp) {
    return { stdout: claudeHelp, stderr: null, exitCode: 0 }
  }

  if (parsed.profile !== null && parsed.channel !== null) {
    return {
      stdout: null,
      stderr: `error: --channel cannot be combined with --profile (profile "${parsed.profile}" already binds a channel)`,
      exitCode: 1,
    }
  }

  const { claude, profiles, localConfig, localConfigSync, listeners } = deps
  const cwd = deps.cwd ?? process.cwd()

  if (parsed.profile !== null) {
    const globalProfile = profiles.get(parsed.profile)

    if (globalProfile) {
      const exitCode = await claude.launch({
        channel: globalProfile.channelId,
        cwd: globalProfile.path,
        userArgs: parsed.userArgs,
        profileId: globalProfile.id,
        options: globalProfile.options,
        env: globalProfile.env,
        resume: globalProfile.resume,
      })

      return { stdout: null, stderr: null, exitCode }
    }

    const localForProfile = localConfig.read(cwd)
    const localProfile = localForProfile?.profiles?.find((p) => p.name === parsed.profile)

    if (localForProfile && localProfile) {
      const picked = pickChannel(localForProfile, localProfile.channel)

      if (typeof picked === "string") {
        return { stdout: null, stderr: `error: ${picked}`, exitCode: 1 }
      }

      const synced = await localConfigSync.ensure(picked)

      await reconcileListeners(listeners, picked.name, synced)

      const exitCode = await claude.launch({
        channel: picked.name,
        cwd,
        userArgs: parsed.userArgs,
        options: localProfile.options,
        env: localProfile.env,
        resume: localProfile.resume,
      })

      return { stdout: null, stderr: null, exitCode }
    }

    return {
      stdout: null,
      stderr: `error: profile "${parsed.profile}" not found`,
      exitCode: 1,
    }
  }

  const local = localConfig.read(cwd)

  if (local) {
    const picked = pickChannel(local, parsed.channel)

    if (typeof picked === "string") {
      return { stdout: null, stderr: `error: ${picked}`, exitCode: 1 }
    }

    // funnel.json was detected at entry (cli/index.ts), which already pointed
    // FUNNEL_DIR at ~/.funnel/projects/<id>/ — so funnel and the daemon it
    // spawns read and write only that scoped root, never the global ~/.funnel.
    // Tokens missing from settings.json are prompted for at sync (TTY) and saved
    // there; they never live in the repo.
    const synced = await localConfigSync.ensure(picked)

    await reconcileListeners(listeners, picked.name, synced)

    // A channel binds transport only — no launch recipe. Options/env/resume come
    // from a profile, reachable solely via `--profile <name>`. The channel never
    // pulls in a profile on its own.
    const exitCode = await claude.launch({
      channel: picked.name,
      cwd,
      userArgs: parsed.userArgs,
    })

    return { stdout: null, stderr: null, exitCode }
  }

  if (parsed.channel !== null) {
    const exitCode = await claude.launch({
      channel: parsed.channel,
      cwd,
      userArgs: parsed.userArgs,
    })

    return { stdout: null, stderr: null, exitCode }
  }

  const defaultProfile = profiles.getDefault()

  if (!defaultProfile) {
    return { stdout: claudeHelp, stderr: null, exitCode: 0 }
  }

  const exitCode = await claude.launch({
    channel: defaultProfile.channelId,
    cwd: defaultProfile.path,
    userArgs: parsed.userArgs,
    profileId: defaultProfile.id,
    options: defaultProfile.options,
    env: defaultProfile.env,
    resume: defaultProfile.resume,
  })

  return { stdout: null, stderr: null, exitCode }
}
