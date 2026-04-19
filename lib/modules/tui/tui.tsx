import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "@/modules/tui/app"

export async function launchTui(): Promise<void> {
  const renderer = await createCliRenderer()

  createRoot(renderer).render(<App />)

  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve())
  })
}
