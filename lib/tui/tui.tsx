/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "@/tui/app"
import { HasciiThemeProvider } from "@/tui/utils/hascii/theme-context"
import type { Funnel } from "@/funnel"

export async function launchTui(funnel: Funnel): Promise<void> {
  const renderer = await createCliRenderer()

  createRoot(renderer).render(
    <HasciiThemeProvider>
      <App funnel={funnel} />
    </HasciiThemeProvider>,
  )

  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve())
  })
}
