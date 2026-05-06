import { describe, expect, test } from "bun:test";
import { FunnelScheduleListener } from "@/connectors/schedule-listener";
import { FunnelScheduleStore } from "@/connectors/schedule-store";
import { ScheduleLastFiredStore } from "@/connectors/schedule-last-fired-store";
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system";

const setup = () => {
  const fs = new MemoryFunnelFileSystem();
  const store = new FunnelScheduleStore({ fs, dir: "/fake" });
  store.add({ type: "schedule", name: "cron-a", entries: [] });
  const lastFiredStore = new ScheduleLastFiredStore({ connector: "cron-a", fs, dir: "/fake" });
  return { fs, store, lastFiredStore };
};

describe("FunnelScheduleListener", () => {
  test("tick fires for matching cron entries", async () => {
    const { store, lastFiredStore } = setup();
    const entry = store.addEntry("cron-a", {
      cron: "15 10 * * *",
      prompt: "morning check",
      enabled: true,
    });

    const now = new Date(2026, 3, 22, 10, 15);
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    });

    const fired: Array<{ content: string; meta?: Record<string, string> }> = [];
    await listener.tick(async (content, meta) => {
      fired.push({ content, meta });
    });

    expect(fired).toHaveLength(1);
    expect(fired[0]?.content).toBe("morning check");
    expect(fired[0]?.meta?.schedule_id).toBe(entry.id);
    expect(fired[0]?.meta?.catchup).toBeUndefined();
  });

  test("tick skips non-matching and disabled entries", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", { cron: "0 9 * * *", prompt: "a", enabled: true });
    store.addEntry("cron-a", { cron: "15 10 * * *", prompt: "disabled", enabled: false });

    const now = new Date(2026, 3, 22, 10, 15);
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    });

    const fired: string[] = [];
    await listener.tick(async (content) => {
      fired.push(content);
    });

    expect(fired).toEqual([]);
  });

  test("does not re-fire within the same minute", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", { cron: "* * * * *", prompt: "every-min", enabled: true });

    const now = new Date(2026, 3, 22, 10, 15);
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    });

    const fired: string[] = [];
    const notify = async (content: string) => {
      fired.push(content);
    };

    await listener.tick(notify);
    await listener.tick(notify);

    expect(fired).toHaveLength(1);
  });

  test("catches up the most recent missed match after downtime", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", { cron: "*/5 * * * *", prompt: "every-5", enabled: true });

    const initial = new Date(2026, 3, 22, 10, 0);
    const listener0 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => initial,
    });
    const firedInitial: string[] = [];
    await listener0.tick(async (c) => {
      firedInitial.push(c);
    });
    expect(firedInitial).toHaveLength(1);

    const after = new Date(2026, 3, 22, 10, 37);
    const listener1 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => after,
    });
    const firedAfter: Array<{ content: string; meta?: Record<string, string> }> = [];
    await listener1.tick(async (c, m) => {
      firedAfter.push({ content: c, meta: m });
    });

    expect(firedAfter).toHaveLength(1);
    expect(firedAfter[0]?.meta?.catchup).toBe("true");
    const firedAt = firedAfter[0]?.meta?.fired_at;
    expect(firedAt).toBeTruthy();
    expect(new Date(firedAt ?? "").getMinutes()).toBe(35);
  });

  test("first-ever run does not catch up historical matches", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", { cron: "0 9 * * *", prompt: "morning", enabled: true });

    const now = new Date(2026, 3, 22, 14, 0);
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    });

    const fired: string[] = [];
    await listener.tick(async (c) => {
      fired.push(c);
    });

    expect(fired).toEqual([]);
  });

  test("catchupPolicy=all fires once per missed minute in chronological order", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", {
      cron: "*/5 * * * *",
      prompt: "every-5",
      enabled: true,
      catchupPolicy: "all",
    });

    const initial = new Date(2026, 3, 22, 10, 0);
    const listener0 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => initial,
    });
    await listener0.tick(async () => {});

    const after = new Date(2026, 3, 22, 10, 37);
    const listener1 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => after,
    });

    const fired: Array<{ content: string; meta?: Record<string, string> }> = [];
    await listener1.tick(async (c, m) => {
      fired.push({ content: c, meta: m });
    });

    const firedMinutes = fired.map((f) => new Date(f.meta?.fired_at ?? "").getMinutes());

    expect(firedMinutes).toEqual([5, 10, 15, 20, 25, 30, 35]);
    expect(fired.every((f) => f.meta?.catchup === "true")).toBe(true);
    expect(fired.every((f) => f.meta?.catchup_policy === "all")).toBe(true);
  });

  test("catchupPolicy=all advances lastFired to the latest match", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", {
      cron: "*/5 * * * *",
      prompt: "every-5",
      enabled: true,
      catchupPolicy: "all",
    });

    const initial = new Date(2026, 3, 22, 10, 0);
    const initListener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => initial,
    });
    await initListener.tick(async () => {});

    const after = new Date(2026, 3, 22, 10, 17);
    const listener1 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => after,
    });
    await listener1.tick(async () => {});

    // Now request another tick — the previous run already fired everything up to 10:15, so
    // a second tick at the same time should produce nothing.
    const fired: string[] = [];
    await listener1.tick(async (c) => {
      fired.push(c);
    });
    expect(fired).toEqual([]);
  });

  test("catchupPolicy=skip fires only when the current minute matches", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", {
      cron: "*/5 * * * *",
      prompt: "every-5",
      enabled: true,
      catchupPolicy: "skip",
    });

    const matching = new Date(2026, 3, 22, 10, 15);
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => matching,
    });

    const fired: Array<{ content: string; meta?: Record<string, string> }> = [];
    await listener.tick(async (c, m) => {
      fired.push({ content: c, meta: m });
    });

    expect(fired).toHaveLength(1);
    expect(fired[0]?.meta?.catchup).toBeUndefined();
    expect(fired[0]?.meta?.catchup_policy).toBe("skip");
  });

  test("catchupPolicy=skip ignores missed past matches", async () => {
    const { store, lastFiredStore } = setup();
    store.addEntry("cron-a", {
      cron: "*/5 * * * *",
      prompt: "every-5",
      enabled: true,
      catchupPolicy: "skip",
    });

    const initial = new Date(2026, 3, 22, 10, 0);
    const initListener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => initial,
    });
    await initListener.tick(async () => {});

    // 10:37 is not a *every-5* match. With "skip", nothing should fire even though 10:05–10:35
    // were missed.
    const after = new Date(2026, 3, 22, 10, 37);
    const listener1 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => after,
    });

    const fired: string[] = [];
    await listener1.tick(async (c) => {
      fired.push(c);
    });

    expect(fired).toEqual([]);
  });
});
