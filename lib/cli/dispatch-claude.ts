import { claudeHelp } from "@/cli/routes/claude"
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
 * Entry point for `fnl claude <args>`. Pulls only funnel-specific flags
 * (--profile / -p, --channel, --help / -h) out of argv and forwards every
 * other token — including positionals and unknown short flags — verbatim
 * to the claude CLI. Routing through Hono cannot do this because positional
 * args would become URL segments and unknown short flags would be silently
 * dropped.
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

  if (parsed.channel !== null && parsed.profile === null) {
    const exitCode = await funnel.claude.launch({
      channel: parsed.channel,
      cwd,
      userArgs: parsed.userArgs,
    })

    return { stdout: null, stderr: null, exitCode }
  }

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
      subAgent: profile.subAgent,
      userArgs: parsed.userArgs,
      profileName: profile.name,
      brief: profile.brief,
    })

    return { stdout: null, stderr: null, exitCode }
  }

  const local = funnel.localConfig.read(cwd)

  if (local) {
    await funnel.localConfigSync.ensure(local, cwd)

    const exitCode = await funnel.claude.launch({
      channel: local.channel,
      cwd,
      subAgent: local.subAgent,
      userArgs: parsed.userArgs,
      brief: local.brief,
      extraEnv: local.env,
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
    subAgent: defaultProfile.subAgent,
    userArgs: parsed.userArgs,
    profileName: defaultProfile.name,
    brief: defaultProfile.brief,
  })

  return { stdout: null, stderr: null, exitCode }
}
