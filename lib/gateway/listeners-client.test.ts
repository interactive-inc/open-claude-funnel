import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { FunnelListenersClient } from "@/gateway/listeners-client";

const startStubServer = (
  handler: (request: Request) => Response | Promise<Response>,
): Server<undefined> => {
  return Bun.serve({ port: 0, fetch: handler });
};

const portOf = (server: Server<undefined>): number => {
  if (server.port === undefined) throw new Error("server has no port");

  return server.port;
};

let server: Server<undefined> | null = null;

afterEach(() => {
  server?.stop();
  server = null;
});

describe("FunnelListenersClient", () => {
  test("operations report state=offline when the daemon is not running", async () => {
    const client = new FunnelListenersClient({
      port: 1,
      isDaemonRunning: () => false,
    });

    expect(await client.start("a")).toEqual({ state: "offline" });
    expect(await client.stop("a")).toEqual({ state: "offline" });
    expect(await client.restart("a")).toEqual({ state: "offline" });
    expect(await client.list()).toEqual({ state: "offline" });
  });

  test("list parses listeners from the daemon", async () => {
    server = startStubServer(() =>
      Response.json({ listeners: [{ name: "a", type: "schedule", alive: true }] }),
    );

    const client = new FunnelListenersClient({
      port: portOf(server),
      isDaemonRunning: () => true,
    });

    const result = await client.list();

    expect(result.state).toBe("ok");

    if (result.state === "ok") {
      expect(result.listeners).toEqual([{ name: "a", type: "schedule", alive: true }]);
    }
  });

  test("start succeeds against an OK response", async () => {
    server = startStubServer((request) => {
      const url = new URL(request.url);
      expect(request.method).toBe("POST");
      expect(url.pathname).toBe("/listeners/foo/start");
      return Response.json({ ok: true });
    });

    const client = new FunnelListenersClient({
      port: portOf(server),
      isDaemonRunning: () => true,
    });

    const result = await client.start("foo");
    expect(result).toEqual({ state: "ok" });
  });

  test("stop sends DELETE to the daemon", async () => {
    const observed: { method: string; pathname: string }[] = [];

    server = startStubServer((request) => {
      observed.push({ method: request.method, pathname: new URL(request.url).pathname });
      return Response.json({ ok: true });
    });

    const client = new FunnelListenersClient({
      port: portOf(server),
      isDaemonRunning: () => true,
    });

    await client.stop("foo");

    expect(observed).toEqual([{ method: "DELETE", pathname: "/listeners/foo" }]);
  });

  test("non-2xx response surfaces the daemon's reason", async () => {
    server = startStubServer(() =>
      Response.json({ ok: false, reason: "connector not found" }, { status: 400 }),
    );

    const client = new FunnelListenersClient({
      port: portOf(server),
      isDaemonRunning: () => true,
    });

    const result = await client.start("missing");

    expect(result.state).toBe("error");

    if (result.state === "error") {
      expect(result.reason).toBe("connector not found");
    }
  });

  test("name is URL-encoded so spaces in connector names work", async () => {
    const pathnames: string[] = [];

    server = startStubServer((request) => {
      pathnames.push(new URL(request.url).pathname);
      return Response.json({ ok: true });
    });

    const client = new FunnelListenersClient({
      port: portOf(server),
      isDaemonRunning: () => true,
    });

    await client.start("name with space");

    expect(pathnames).toEqual(["/listeners/name%20with%20space/start"]);
  });

  test("network failure (daemon supposedly running but unreachable) returns state=error", async () => {
    const client = new FunnelListenersClient({
      port: 1,
      isDaemonRunning: () => true,
    });

    const result = await client.start("a");

    expect(result.state).toBe("error");
  });
});
