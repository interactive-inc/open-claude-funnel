// Test helper; the library uses the same memory store in production.
export { MemoryFunnelSettingsStore as MockFunnelSettingsReader } from "@/engine/settings/memory-settings-store"
export const createSettings = (partial = {}) => ({ channels: [], ...partial })
