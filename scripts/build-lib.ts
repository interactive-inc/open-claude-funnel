import pkg from "../package.json"

const external = Object.keys(pkg.dependencies)

const result = await Bun.build({
  entrypoints: ["lib/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  external,
})

if (!result.success) {
  for (const log of result.logs) console.error(log)

  process.exit(1)
}

for (const out of result.outputs) {
  console.log(out.path, `${(out.size / 1024).toFixed(1)} KB`)
}
