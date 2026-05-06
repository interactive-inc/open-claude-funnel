import { describe, expect, test } from "bun:test";
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system";
import { JsonlReplaySource } from "@/gateway/jsonl-replay-source";

const seed = (fs: MemoryFunnelFileSystem, file: string, lines: object[]) => {
  const dir = file.replace(/\/[^/]+$/, "");
  fs.mkdirSync(dir);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
};

describe("JsonlReplaySource", () => {
  test("findMaxOffset returns 0 when no log files exist", () => {
    const fs = new MemoryFunnelFileSystem();
    const source = new JsonlReplaySource({ logDir: "/events", fs });

    expect(source.findMaxOffset()).toBe(0);
  });

  test("findMaxOffset returns the highest offset across files", () => {
    const fs = new MemoryFunnelFileSystem();
    seed(fs, "/events/2026-04-01.jsonl", [
      { offset: 1, content: "a", meta: {} },
      { offset: 2, content: "b", meta: {} },
    ]);
    seed(fs, "/events/2026-04-02.jsonl", [
      { offset: 3, content: "c", meta: {} },
      { offset: 7, content: "d", meta: {} },
    ]);
    const source = new JsonlReplaySource({ logDir: "/events", fs });

    expect(source.findMaxOffset()).toBe(7);
  });

  test("findMaxOffset ignores entries with null offset (system events)", () => {
    const fs = new MemoryFunnelFileSystem();
    seed(fs, "/events/2026-04-01.jsonl", [
      { offset: null, content: "gateway started", meta: { event_type: "system" } },
      { offset: 5, content: "hello", meta: {} },
    ]);
    const source = new JsonlReplaySource({ logDir: "/events", fs });

    expect(source.findMaxOffset()).toBe(5);
  });

  test("loadSince returns events strictly after since, sorted ascending", () => {
    const fs = new MemoryFunnelFileSystem();
    seed(fs, "/events/2026-04-01.jsonl", [
      { offset: 1, content: "a" },
      { offset: 2, content: "b" },
      { offset: 3, content: "c" },
    ]);
    const source = new JsonlReplaySource({ logDir: "/events", fs });

    const out = source.loadSince(1);

    expect(out.map((e) => e.content)).toEqual(["b", "c"]);
    expect(out.map((e) => e.offset)).toEqual([2, 3]);
  });

  test("loadSince spans multiple files in chronological order", () => {
    const fs = new MemoryFunnelFileSystem();
    seed(fs, "/events/2026-04-01.jsonl", [
      { offset: 1, content: "a" },
      { offset: 2, content: "b" },
    ]);
    seed(fs, "/events/2026-04-02.jsonl", [{ offset: 3, content: "c" }]);

    const source = new JsonlReplaySource({ logDir: "/events", fs });

    const out = source.loadSince(0);

    expect(out.map((e) => e.offset)).toEqual([1, 2, 3]);
  });

  test("loadSince respects maxEvents", () => {
    const fs = new MemoryFunnelFileSystem();
    seed(fs, "/events/2026-04-01.jsonl", [
      { offset: 1, content: "a" },
      { offset: 2, content: "b" },
      { offset: 3, content: "c" },
      { offset: 4, content: "d" },
    ]);
    const source = new JsonlReplaySource({ logDir: "/events", fs, maxEvents: 2 });

    const out = source.loadSince(0);

    expect(out.length).toBe(2);
  });

  test("loadSince scans only the latest fileLimit days", () => {
    const fs = new MemoryFunnelFileSystem();
    seed(fs, "/events/2026-03-01.jsonl", [{ offset: 1, content: "old" }]);
    seed(fs, "/events/2026-04-01.jsonl", [{ offset: 2, content: "newer" }]);
    seed(fs, "/events/2026-04-02.jsonl", [{ offset: 3, content: "newest" }]);

    const source = new JsonlReplaySource({ logDir: "/events", fs, fileLimit: 2 });

    const out = source.loadSince(0);

    expect(out.map((e) => e.content)).toEqual(["newer", "newest"]);
  });

  test("loadSince skips unparseable lines", () => {
    const fs = new MemoryFunnelFileSystem();
    fs.mkdirSync("/events");
    fs.writeFileSync(
      "/events/2026-04-01.jsonl",
      `{"offset": 1, "content": "good"}\nnot-json\n{"offset": 2, "content": "good2"}\n`,
    );

    const source = new JsonlReplaySource({ logDir: "/events", fs });

    const out = source.loadSince(0);

    expect(out.map((e) => e.content)).toEqual(["good", "good2"]);
  });

  test("returns [] when log directory does not exist", () => {
    const fs = new MemoryFunnelFileSystem();
    const source = new JsonlReplaySource({ logDir: "/nope", fs });

    expect(source.findMaxOffset()).toBe(0);
    expect(source.loadSince(0)).toEqual([]);
  });
});
