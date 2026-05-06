import { describe, expect, test } from "bun:test";
import { uniqueName } from "@/tui/unique-name";

describe("uniqueName", () => {
  test("returns the first numeric suffix when none exists", () => {
    expect(uniqueName([], "slack")).toBe("slack-1");
  });

  test("skips suffixes already taken", () => {
    expect(uniqueName(["slack-1", "slack-2"], "slack")).toBe("slack-3");
  });

  test("ignores names with the wrong prefix", () => {
    expect(uniqueName(["gh-1", "gh-2", "slack-2"], "slack")).toBe("slack-1");
  });

  test("returns the first free numeric slot up to the cap", () => {
    const taken = Array.from({ length: 4999 }, (_, i) => `x-${i + 1}`);
    expect(uniqueName(taken, "x")).toBe("x-5000");
  });

  test("falls back to a timestamp suffix when every numeric slot is taken", () => {
    const taken = Array.from({ length: 9999 }, (_, i) => `x-${i + 1}`);
    expect(uniqueName(taken, "x")).toMatch(/^x-\d+$/);
  });
});
