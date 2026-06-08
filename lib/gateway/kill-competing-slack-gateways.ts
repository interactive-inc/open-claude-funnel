import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"

type Props = {
  selfPid: number
  /** Funnel home directory. Only daemons rooted at the same dir share Slack tokens and are killed. */
  dir: string
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  /** Override for tests. Defaults to a real `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
}

const defaultProcess = new NodeFunnelProcessRunner()

// A SIGTERM'd daemon runs its graceful shutdown (closing the Socket Mode socket)
// for up to ~3s before exiting; wait that long before force-killing a straggler.
const SIGTERM_GRACE_MS = 3000
const POLL_INTERVAL_MS = 100
const SIGKILL_GRACE_MS = 200

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const titleFor = (dir: string): string => `funnel-gateway[${dir}]`

// Blocks until every killed pid has exited, SIGKILLing stragglers that ignore
// SIGTERM past the grace window. Returning before the old daemon's Socket Mode
// socket is closed would leave two connections with the same token live at once,
// and Slack splits inbound events between them.
const waitForExit = async (props: {
  runner: FunnelProcessRunner
  pids: number[]
  sleep: (ms: number) => Promise<void>
  now: () => number
}): Promise<void> => {
  const deadline = props.now() + SIGTERM_GRACE_MS

  while (props.now() < deadline) {
    if (props.pids.every((pid) => !props.runner.isAlive(pid))) return

    await props.sleep(POLL_INTERVAL_MS)
  }

  for (const pid of props.pids) {
    if (!props.runner.isAlive(pid)) continue

    try {
      props.runner.kill(pid, "SIGKILL")
    } catch {
      // The process may have exited between the check and the kill — ignore.
    }
  }

  await props.sleep(SIGKILL_GRACE_MS)
}

/**
 * Kills other funnel daemon processes that share the SAME funnel home dir,
 * which is the only situation that causes a real conflict (duplicate Slack
 * Socket Mode connections with the same tokens). Daemons rooted at a
 * different `~/.funnel/` are left alone — they hold different tokens and
 * speak to different Slack apps. The daemon advertises its dir via the
 * `funnel-gateway[<dir>]` marker appended to argv (also assigned to
 * `process.title` on POSIX). `FunnelProcessRunner.listProcessesContaining`
 * absorbs the POSIX/Windows enumeration difference behind the marker match.
 *
 * Waits for the killed daemons to actually exit before returning, so the caller
 * can bind the port and open a fresh Socket Mode connection without overlapping
 * the old one (the overlap is what makes Slack split inbound events).
 */
export const killCompetingSlackGateways = async (props: Props): Promise<number[]> => {
  const runner = props.process ?? defaultProcess
  const logger = props.logger
  const expectedTitle = titleFor(props.dir)
  const snapshots = runner.listProcessesContaining(expectedTitle)
  const killed: number[] = []

  for (const snapshot of snapshots) {
    if (snapshot.pid === props.selfPid) continue

    runner.kill(snapshot.pid, "SIGTERM")
    killed.push(snapshot.pid)

    logger?.info("killed competing Slack gateway process", {
      pid: snapshot.pid,
      args: snapshot.command.slice(0, 160),
    })
  }

  if (killed.length === 0) return killed

  await waitForExit({
    runner,
    pids: killed,
    sleep: props.sleep ?? defaultSleep,
    now: props.now ?? (() => Date.now()),
  })

  return killed
}
