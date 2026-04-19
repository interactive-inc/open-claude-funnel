import { logger } from "@/modules/logger"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"

type Props = {
  selfPid: number
  process?: FunnelProcessRunner
}

const defaultProcess = new NodeFunnelProcessRunner()

const isBun = (args: string): boolean => {
  return args.includes("bun ") || /\/bun(\s|$)/.test(args)
}

const looksLikeSlackGateway = (args: string): boolean => {
  return /(gateway|bolt|slack)/i.test(args)
}

export const killCompetingSlackGateways = async (props: Props): Promise<number[]> => {
  const runner = props.process ?? defaultProcess
  const result = await runner.run(["ps", "-e", "-o", "pid=,args="])

  if (result.exitCode !== 0) return []

  const killed: number[] = []

  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim()

    if (!line) continue

    const match = /^(\d+)\s+(.+)$/.exec(line)

    if (!match) continue

    const pid = Number(match[1])
    const args = match[2]!

    if (!Number.isInteger(pid) || pid <= 0) continue
    if (pid === props.selfPid) continue
    if (!isBun(args)) continue
    if (!looksLikeSlackGateway(args)) continue

    runner.kill(pid, "SIGTERM")
    killed.push(pid)

    logger.info("killed competing Slack gateway process", { pid, args: args.slice(0, 160) })
  }

  return killed
}
