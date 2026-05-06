import { describe, expect, test } from "bun:test";
import type { ConnectorConfig } from "@/connectors/connector-config-schema";
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener";
import { type ConnectorRegistry, FunnelListenerSupervisor } from "@/gateway/listener-supervisor";

class FakeListener extends FunnelConnectorListener {
  startCalls = 0;
  stopCalls = 0;
  alive = true;
  failNextStart = false;
  notifyOnStart: { content: string; meta?: Record<string, string> } | null = null;

  async start(notify: NotifyFn): Promise<void> {
    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error("forced failure");
    }

    this.startCalls += 1;
    this.alive = true;

    if (this.notifyOnStart) {
      await notify(this.notifyOnStart.content, this.notifyOnStart.meta);
    }
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.alive = false;
  }

  override isAlive(): boolean {
    return this.alive;
  }

  die(): void {
    this.alive = false;
  }
}

const makeRegistry = (
  entries: { config: ConnectorConfig; listener: FunnelConnectorListener }[],
): ConnectorRegistry => {
  return {
    list: () => entries.map((entry) => entry.config),
    createListenerFor: (name) => entries.find((entry) => entry.config.name === name) ?? null,
  };
};

const makeFake = (name: string): { config: ConnectorConfig; listener: FakeListener } => {
  return {
    config: { type: "schedule", name, entries: [] },
    listener: new FakeListener(),
  };
};

describe("FunnelListenerSupervisor", () => {
  test("start adds the listener to the registry", async () => {
    const fake = makeFake("sched-a");
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
    });

    const result = await supervisor.start("sched-a");

    expect(result.ok).toBe(true);
    expect(fake.listener.startCalls).toBe(1);
    expect(supervisor.isRunning("sched-a")).toBe(true);
    expect(supervisor.list()).toEqual([
      {
        name: "sched-a",
        type: "schedule",
        alive: true,
        events: 0,
        errors: 0,
        failureCount: 0,
        lastEventAt: null,
      },
    ]);
  });

  test("start on unknown connector returns ok=false", async () => {
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([]),
      notify: async () => {},
    });

    const result = await supervisor.start("missing");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  test("starting a listener that is already running is a no-op", async () => {
    const fake = makeFake("sched-a");
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
    });

    await supervisor.start("sched-a");
    const second = await supervisor.start("sched-a");

    expect(second.ok).toBe(true);
    expect(second.reason).toBe("already running");
    expect(fake.listener.startCalls).toBe(1);
  });

  test("listener.start failure is reported and not added to registry", async () => {
    const fake = makeFake("sched-a");
    fake.listener.failNextStart = true;

    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
    });

    const result = await supervisor.start("sched-a");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/forced failure/);
    expect(supervisor.isRunning("sched-a")).toBe(false);
  });

  test("stop removes from registry and calls listener.stop", async () => {
    const fake = makeFake("sched-a");
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
    });

    await supervisor.start("sched-a");
    const result = await supervisor.stop("sched-a");

    expect(result.ok).toBe(true);
    expect(fake.listener.stopCalls).toBe(1);
    expect(supervisor.isRunning("sched-a")).toBe(false);
  });

  test("stop on a non-running listener is a soft success", async () => {
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([]),
      notify: async () => {},
    });

    const result = await supervisor.stop("sched-a");

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("not running");
  });

  test("restart stops then starts again", async () => {
    const fake = makeFake("sched-a");
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
    });

    await supervisor.start("sched-a");
    await supervisor.restart("sched-a");

    expect(fake.listener.startCalls).toBe(2);
    expect(fake.listener.stopCalls).toBe(1);
    expect(supervisor.isRunning("sched-a")).toBe(true);
  });

  test("notify wraps content with the connector name", async () => {
    const fake = makeFake("sched-a");
    fake.listener.notifyOnStart = { content: "tick", meta: { event_type: "schedule" } };

    const calls: { name: string; content: string; meta?: Record<string, string> }[] = [];
    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async (name, content, meta) => {
        calls.push({ name, content, meta });
      },
    });

    await supervisor.start("sched-a");

    expect(calls).toEqual([{ name: "sched-a", content: "tick", meta: { event_type: "schedule" } }]);
  });

  test("startAll boots every connector", async () => {
    const a = makeFake("sched-a");
    const b = makeFake("sched-b");

    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([a, b]),
      notify: async () => {},
    });

    await supervisor.startAll();

    expect(a.listener.startCalls).toBe(1);
    expect(b.listener.startCalls).toBe(1);
    expect(supervisor.list().length).toBe(2);
  });

  test("stopAll stops every running listener", async () => {
    const a = makeFake("sched-a");
    const b = makeFake("sched-b");

    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([a, b]),
      notify: async () => {},
    });

    await supervisor.startAll();
    await supervisor.stopAll();

    expect(a.listener.stopCalls).toBe(1);
    expect(b.listener.stopCalls).toBe(1);
    expect(supervisor.list()).toEqual([]);
  });

  test("health check restarts a dead listener", async () => {
    const fake = makeFake("sched-a");
    const sleeps: number[] = [];

    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
      healthCheckIntervalMs: 10,
      maxBackoffMs: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await supervisor.startAll();
    fake.listener.die();

    await new Promise((r) => setTimeout(r, 50));

    expect(fake.listener.startCalls).toBeGreaterThanOrEqual(2);
    expect(fake.listener.stopCalls).toBeGreaterThanOrEqual(1);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps[0]).toBe(5);

    await supervisor.stopAll();
  });

  test("successful recovery resets the failure counter", async () => {
    const fake = makeFake("sched-a");
    const sleeps: number[] = [];

    const supervisor = new FunnelListenerSupervisor({
      connectors: makeRegistry([fake]),
      notify: async () => {},
      healthCheckIntervalMs: 10,
      maxBackoffMs: 1_000_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await supervisor.startAll();
    fake.listener.die();
    await new Promise((r) => setTimeout(r, 50));
    fake.listener.die();
    await new Promise((r) => setTimeout(r, 50));

    expect(sleeps.every((ms) => ms === 1000)).toBe(true);

    await supervisor.stopAll();
  });
});
