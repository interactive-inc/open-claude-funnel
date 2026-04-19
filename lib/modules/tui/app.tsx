import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"

const zinc = {
  50: "#fafafa",
  600: "#52525b",
  950: "#09090b",
} as const

const LABEL = "funnel"

export function App() {
  const renderer = useRenderer()

  const dimensions = useTerminalDimensions()

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
    }
  })

  const marginLeft = Math.max(0, Math.floor((dimensions.width - LABEL.length) / 2))

  const marginTop = Math.max(0, Math.floor(dimensions.height / 2) - 1)

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: zinc[950],
      }}
    >
      <box style={{ height: marginTop, backgroundColor: zinc[950] }} />
      <text fg={zinc[50]} bg={zinc[950]} style={{ marginLeft }}>
        {LABEL}
      </text>
      <text fg={zinc[600]} bg={zinc[950]} position="absolute" bottom={0}>
        press q to quit
      </text>
    </box>
  )
}
