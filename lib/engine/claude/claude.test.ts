import { describe, expect, test } from "bun:test";
import { FunnelChannels } from "@/engine/channels/channels";
import { FunnelClaude } from "@/engine/claude/claude";
import { FunnelConnectors } from "@/connectors/connectors";
import { createConnectorStores } from "@/connectors/connector-stores";
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system";
import { FunnelGateway } from "@/gateway/gateway";
import { FunnelMcp } from "@/engine/mcp/mcp";
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner";
import { FunnelProfiles } from "@/engine/profiles/profiles";
import { FunnelRepositories } from "@/engine/repos/repositories";
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader";

const makeClaude = () => {
  const store = new MockFunnelSettingsReader({
    channels: [{ name: "inbox", connectors: [], delivery: "fanout" }],
    repositories: [{ name: "r", path: "/repo" }],
    profiles: [],
  });
  const fs = new MemoryFunnelFileSystem({
    dirs: ["/repo"],
    files: { [`${process.env.HOME}/.funnel/gateway.pid`]: "1" },
  });
  // ps returning exitCode 0 + state "R" means alive
  const runner = new MemoryFunnelProcessRunner().onSync(() => ({
    exitCode: 0,
    stdout: "R\n",
    stderr: "",
  }));
  const mcp = new FunnelMcp({ fs });
  const gateway = new FunnelGateway({ fs, process: runner });

  const stores = createConnectorStores({ fs });
  const profiles = new FunnelProfiles({ store });
  const channels: FunnelChannels = new FunnelChannels({
    store,
    connectorChecker: { has: (name: string) => connectors.has(name) },
    profileChecker: profiles,
    profileRefUpdater: profiles,
  });
  const connectors: FunnelConnectors = new FunnelConnectors({
    ...stores,
    refUpdater: channels,
  });
  const claude = new FunnelClaude({
    channels,
    repositories: new FunnelRepositories({ store, mcp }),
    mcp,
    gateway,
    process: runner,
    fs,
  });

  return { claude, runner, fs, mcp };
};

describe("FunnelClaude", () => {
  test("launch invokes claude via attach", async () => {
    const { claude, runner } = makeClaude();

    await claude.launch({ channel: "inbox", repo: "r" });

    const attach = runner.calls.find((c) => c.kind === "attach");
    expect(attach?.command[0]).toBe("claude");
  });

  test("missing channel throws Error", async () => {
    const { claude } = makeClaude();

    expect(claude.launch({ channel: "missing" })).rejects.toThrow(/channel "missing" not found/);
  });

  test("injects FUNNEL_CHANNEL_ID into env", async () => {
    const { claude, runner } = makeClaude();

    await claude.launch({ channel: "inbox", repo: "r" });

    const attach = runner.calls.find((c) => c.kind === "attach");
    if (attach?.kind !== "attach") throw new Error("expected attach call");

    expect(attach.options.env?.FUNNEL_CHANNEL_ID).toBe("inbox");
  });

  test("cwd is the repo path", async () => {
    const { claude, runner } = makeClaude();

    await claude.launch({ channel: "inbox", repo: "r" });

    const attach = runner.calls.find((c) => c.kind === "attach");
    if (attach?.kind !== "attach") throw new Error("expected attach call");

    expect(attach.options.cwd).toBe("/repo");
  });

  test("--dangerously-load-development-channels is auto-appended", async () => {
    const { claude, runner, mcp } = makeClaude();

    // install MCP beforehand (registered under the funnel key)
    mcp.install("/repo");

    await claude.launch({ channel: "inbox", repo: "r" });

    const attach = runner.calls.find((c) => c.kind === "attach");
    const args = attach?.command.slice(1) ?? [];

    expect(args).toContain("--dangerously-load-development-channels");
    expect(args).toContain("server:funnel");
  });

  test("--sub-agent option is forwarded to --agent", async () => {
    const { claude, runner } = makeClaude();

    await claude.launch({ channel: "inbox", repo: "r", subAgent: "cto" });

    const attach = runner.calls.find((c) => c.kind === "attach");
    const args = attach?.command ?? [];
    const idx = args.indexOf("--agent");

    expect(idx).toBeGreaterThan(0);
    expect(args[idx + 1]).toBe("cto");
  });
});
