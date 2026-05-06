import { useEffect, useState } from "react";
import { z } from "zod";
import type { StreamEvent, StreamStatus } from "@/tui/types";

const MAX_BUFFER = 200;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

const eventPayloadSchema = z.object({
  content: z.string(),
  meta: z.record(z.string(), z.string()).optional(),
  offset: z.number().int().nonnegative().optional(),
});

type Result = {
  events: StreamEvent[];
  status: StreamStatus;
  reset: () => void;
};

/**
 * Opens a `tap=all` WebSocket against the gateway daemon and accumulates
 * received events in a ring buffer. Reconnects with capped exponential
 * backoff. Returns `disabled` status until the daemon comes online.
 *
 * `token` is appended as `?token=` so the gateway accepts the upgrade.
 */
export const useEventStream = (
  port: number,
  daemonReachable: boolean,
  token: string | null,
): Result => {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("disabled");
  const [resetTick, setResetTick] = useState(0);

  useEffect(() => {
    if (!daemonReachable) {
      setStatus("disabled");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let nextId = events.length > 0 ? Math.max(...events.map((e) => e.id)) + 1 : 1;
    let lastOffset = 0;

    const connect = () => {
      if (cancelled) return;

      setStatus("connecting");
      const sinceQuery = lastOffset > 0 ? `&since=${lastOffset}` : "";
      const protocols = token ? [`funnel.token.${token}`] : undefined;
      socket = new WebSocket(`ws://localhost:${port}/ws?tap=all${sinceQuery}`, protocols);

      socket.addEventListener("open", () => {
        if (cancelled) return;

        attempt = 0;
        setStatus("open");
      });

      socket.addEventListener("message", (event) => {
        if (cancelled) return;

        const raw: unknown = (() => {
          try {
            return JSON.parse(String(event.data));
          } catch {
            return null;
          }
        })();
        const parsed = eventPayloadSchema.safeParse(raw);

        if (!parsed.success) return;

        if (typeof parsed.data.offset === "number") {
          lastOffset = parsed.data.offset;
        }

        const next: StreamEvent = {
          id: nextId,
          receivedAt: Date.now(),
          content: parsed.data.content,
          meta: parsed.data.meta ?? {},
        };
        nextId += 1;

        setEvents((prev) => {
          const merged = [next, ...prev];
          return merged.length > MAX_BUFFER ? merged.slice(0, MAX_BUFFER) : merged;
        });
      });

      socket.addEventListener("close", () => {
        if (cancelled) return;

        setStatus("closed");
        attempt += 1;

        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);

        reconnectTimer = setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        // close fires after error; reconnect happens there.
      });
    };

    connect();

    return () => {
      cancelled = true;

      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
    // events / nextId intentionally captured at hook entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, daemonReachable, resetTick, token]);

  return {
    events,
    status,
    reset: () => {
      setEvents([]);
      setResetTick((value) => value + 1);
    },
  };
};
