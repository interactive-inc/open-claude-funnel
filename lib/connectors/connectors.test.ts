import { describe, expect, test } from "bun:test";
import { FunnelChannels } from "@/engine/channels/channels";
import { FunnelConnectors } from "@/connectors/connectors";
import { createConnectorStores } from "@/connectors/connector-stores";
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system";
import { FunnelProfiles } from "@/engine/profiles/profiles";
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader";
import { MemoryFunnelClock } from "@/engine/time/memory-clock";

const makeService = (clock?: MemoryFunnelClock) => {
  const store = new MockFunnelSettingsReader();
  const fs = new MemoryFunnelFileSystem();
  const stores = createConnectorStores({ fs, dir: "/fake", clock });
  const profiles = new FunnelProfiles({ store });

  const channels: FunnelChannels = new FunnelChannels({
    store,
    connectorChecker: { has: (name: string) => service.has(name) },
    profileChecker: profiles,
    profileRefUpdater: profiles,
  });

  const service: FunnelConnectors = new FunnelConnectors({
    ...stores,
    refUpdater: channels,
  });

  return { store, fs, service, channels };
};

const makeSample = () => ({
  type: "slack" as const,
  name: "slack-a",
  botToken: "xoxb-a",
  appToken: "xapp-a",
});

const expectSlackBotToken = (conn: ReturnType<FunnelConnectors["get"]>, expected: string): void => {
  expect(conn?.type).toBe("slack");
  if (conn?.type === "slack") {
    expect(conn.botToken).toBe(expected);
  }
};

describe("FunnelConnectors", () => {
  test("list is empty by default", () => {
    const { service } = makeService();
    expect(service.list()).toEqual([]);
  });

  test("add stores and get returns the entry", () => {
    const { service } = makeService();
    service.add(makeSample());
    expectSlackBotToken(service.get("slack-a"), "xoxb-a");
  });

  test("adding a duplicate name fails", () => {
    const { service } = makeService();
    service.add(makeSample());
    expect(() => service.add(makeSample())).toThrow(/already exists/);
  });

  test("rename also updates channel connector references", () => {
    const { service, store } = makeService();
    service.add(makeSample());
    const settings = store.read();
    settings.channels.push({ name: "inbox", connectors: ["slack-a"], delivery: "fanout" });
    store.write(settings);

    service.rename("slack-a", "slack-b");

    expect(service.get("slack-a")).toBeNull();
    expectSlackBotToken(service.get("slack-b"), "xoxb-a");
    expect(store.read().channels[0]?.connectors).toEqual(["slack-b"]);
  });

  test("remove also removes channel connector references", () => {
    const { service, store } = makeService();
    service.add(makeSample());
    const settings = store.read();
    settings.channels.push({
      name: "inbox",
      connectors: ["slack-a", "slack-b"],
      delivery: "fanout",
    });
    store.write(settings);

    service.remove("slack-a");

    expect(service.list()).toEqual([]);
    expect(store.read().channels[0]?.connectors).toEqual(["slack-b"]);
  });

  test("updateSlack can change botToken", () => {
    const { service } = makeService();
    service.add(makeSample());
    service.updateSlack("slack-a", { botToken: "xoxb-new" });
    expectSlackBotToken(service.get("slack-a"), "xoxb-new");
  });

  test("can add a gh connector", () => {
    const { service } = makeService();
    service.add({ type: "gh", name: "my-gh", pollInterval: 30 });
    const conn = service.get("my-gh");
    expect(conn?.type).toBe("gh");
    if (conn?.type === "gh") {
      expect(conn.pollInterval).toBe(30);
    }
  });

  test("can add a discord connector", () => {
    const { service } = makeService();
    service.add({ type: "discord", name: "my-dc", botToken: "a".repeat(50) });
    expect(service.get("my-dc")?.type).toBe("discord");
  });

  test("renaming an unregistered connector fails", () => {
    const { service } = makeService();
    expect(() => service.rename("missing", "x")).toThrow(/not found/);
  });

  test("updateSlack on a non-existent name throws", () => {
    const { service } = makeService();
    expect(() => service.updateSlack("missing", { botToken: "xoxb-x" })).toThrow(/not found/);
  });

  test("callSlack on a non-existent name throws", () => {
    const { service } = makeService();
    expect(service.callSlack("missing", { method: "POST", path: "/" })).rejects.toThrow(
      /not found/,
    );
  });

  test("add stamps createdAt and updatedAt to the clock's iso", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { service } = makeService(clock);
    service.add(makeSample());
    const conn = service.get("slack-a");

    expect(conn?.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(conn?.updatedAt).toBe("2026-05-04T10:00:00.000Z");
  });

  test("update bumps updatedAt while preserving createdAt", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { service } = makeService(clock);
    service.add(makeSample());

    clock.advance(60_000);
    service.updateSlack("slack-a", { botToken: "xoxb-new" });

    const conn = service.get("slack-a");
    expect(conn?.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(conn?.updatedAt).toBe("2026-05-04T10:01:00.000Z");
  });

  test("gh add + update stamps timestamps the same way", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { service } = makeService(clock);
    service.add({ type: "gh", name: "my-gh", pollInterval: 60 });
    clock.advance(120_000);
    service.updateGh("my-gh", { pollInterval: 30 });

    const conn = service.get("my-gh");
    expect(conn?.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(conn?.updatedAt).toBe("2026-05-04T10:02:00.000Z");
  });

  test("discord add + update stamps timestamps the same way", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { service } = makeService(clock);
    service.add({ type: "discord", name: "dc", botToken: "a".repeat(20) });
    clock.advance(30_000);
    service.updateDiscord("dc", { botToken: "b".repeat(20) });

    const conn = service.get("dc");
    expect(conn?.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(conn?.updatedAt).toBe("2026-05-04T10:00:30.000Z");
  });
});
