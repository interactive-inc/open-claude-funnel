import { describe, expect, test } from "bun:test";
import { Funnel } from "@/funnel";
import { FunnelChannels } from "@/engine/channels/channels";
import { FunnelClaude } from "@/engine/claude/claude";
import { FunnelConnectors } from "@/connectors/connectors";
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system";
import { FunnelGateway } from "@/gateway/gateway";
import { FunnelListenersClient } from "@/gateway/listeners-client";
import { FunnelLogger } from "@/engine/logger/logger";
import { FunnelMcp } from "@/engine/mcp/mcp";
import { FunnelProcessRunner } from "@/engine/process/process-runner";
import { FunnelProfiles } from "@/engine/profiles/profiles";
import { FunnelRepositories } from "@/engine/repos/repositories";
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader";

describe("Funnel", () => {
  const store = new MockFunnelSettingsReader();
  const fs = new MemoryFunnelFileSystem();
  const funnel = new Funnel({ store, fs, dir: "/fake" });

  test("getters return each service", () => {
    expect(funnel.connectors).toBeInstanceOf(FunnelConnectors);
    expect(funnel.channels).toBeInstanceOf(FunnelChannels);
    expect(funnel.profiles).toBeInstanceOf(FunnelProfiles);
    expect(funnel.repositories).toBeInstanceOf(FunnelRepositories);
    expect(funnel.claude).toBeInstanceOf(FunnelClaude);
    expect(funnel.gateway).toBeInstanceOf(FunnelGateway);
    expect(funnel.listeners).toBeInstanceOf(FunnelListenersClient);
    expect(funnel.process).toBeInstanceOf(FunnelProcessRunner);
    expect(funnel.logger).toBeInstanceOf(FunnelLogger);
    expect(funnel.mcp).toBeInstanceOf(FunnelMcp);
  });

  test("getters return a fresh instance each time (not memoized)", () => {
    expect(funnel.connectors).not.toBe(funnel.connectors);
  });
});
