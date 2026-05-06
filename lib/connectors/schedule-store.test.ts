import { describe, expect, test } from "bun:test";
import { FunnelScheduleStore } from "@/connectors/schedule-store";
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system";
import { MemoryFunnelClock } from "@/engine/time/memory-clock";

const makeStore = (clock?: MemoryFunnelClock) => {
  const fs = new MemoryFunnelFileSystem();
  return { fs, store: new FunnelScheduleStore({ fs, dir: "/fake", clock }) };
};

describe("FunnelScheduleStore", () => {
  test("add creates an empty connector", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });

    const config = store.get("cron-a");
    expect(config?.type).toBe("schedule");
    expect(config?.entries).toEqual([]);
  });

  test("adding a duplicate fails", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    expect(() => store.add({ type: "schedule", name: "cron-a", entries: [] })).toThrow(
      /already exists/,
    );
  });

  test("addEntry appends a JSONL line", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    const entry = store.addEntry("cron-a", { cron: "* * * * *", prompt: "hi", enabled: true });

    expect(entry.id).toBeTruthy();
    expect(store.get("cron-a")?.entries).toEqual([entry]);
  });

  test("removeEntry removes the line", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    const a = store.addEntry("cron-a", { cron: "* * * * *", prompt: "a", enabled: true });
    const b = store.addEntry("cron-a", { cron: "*/5 * * * *", prompt: "b", enabled: true });

    store.removeEntry("cron-a", a.id);

    const entries = store.get("cron-a")?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(b.id);
  });

  test("removeEntry on missing id throws", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    expect(() => store.removeEntry("cron-a", "nope")).toThrow(/not found/);
  });

  test("list scans all .jsonl files", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    store.add({ type: "schedule", name: "cron-b", entries: [] });

    const names = store
      .list()
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["cron-a", "cron-b"]);
  });

  test("readEntries skips invalid JSON lines without throwing", () => {
    const { store, fs } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    const valid = store.addEntry("cron-a", { cron: "* * * * *", prompt: "ok", enabled: true });

    fs.appendFileSync("/fake/connectors/schedule/cron-a.jsonl", "{not json}\n");
    fs.appendFileSync(
      "/fake/connectors/schedule/cron-a.jsonl",
      `${JSON.stringify({ id: "x", cron: "" })}\n`,
    );

    const entries = store.get("cron-a")?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(valid.id);
  });

  test("rename moves the file", () => {
    const { store } = makeStore();
    store.add({ type: "schedule", name: "cron-a", entries: [] });
    store.addEntry("cron-a", { cron: "* * * * *", prompt: "hi", enabled: true });

    store.rename("cron-a", "cron-b");

    expect(store.get("cron-a")).toBeNull();
    expect(store.get("cron-b")?.entries).toHaveLength(1);
  });

  test("add stamps createdAt and updatedAt via the clock", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { store } = makeStore(clock);

    store.add({ type: "schedule", name: "cron-a", entries: [] });

    const config = store.get("cron-a");
    expect(config?.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(config?.updatedAt).toBe("2026-05-04T10:00:00.000Z");
  });

  test("addEntry bumps updatedAt while preserving createdAt", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { store } = makeStore(clock);
    store.add({ type: "schedule", name: "cron-a", entries: [] });

    clock.advance(60_000);
    store.addEntry("cron-a", { cron: "* * * * *", prompt: "hi", enabled: true });

    const config = store.get("cron-a");
    expect(config?.createdAt).toBe("2026-05-04T10:00:00.000Z");
    expect(config?.updatedAt).toBe("2026-05-04T10:01:00.000Z");
  });

  test("rename moves the meta sidecar so timestamps survive", () => {
    const clock = new MemoryFunnelClock({ start: new Date("2026-05-04T10:00:00Z") });
    const { store } = makeStore(clock);
    store.add({ type: "schedule", name: "cron-a", entries: [] });

    store.rename("cron-a", "cron-b");

    expect(store.get("cron-b")?.createdAt).toBe("2026-05-04T10:00:00.000Z");
  });
});
