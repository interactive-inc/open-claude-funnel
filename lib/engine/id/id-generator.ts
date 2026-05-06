/**
 * ID generator boundary. Default NodeFunnelIdGenerator wraps `crypto.randomUUID()`;
 * MemoryFunnelIdGenerator emits `<prefix>-1, <prefix>-2, ...` for deterministic tests.
 */
export abstract class FunnelIdGenerator {
  abstract generate(): string;
}
