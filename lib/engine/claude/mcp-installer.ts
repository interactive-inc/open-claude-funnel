export type McpInstaller = {
  findInstalledName(cwd: string): string | null
  install(cwd: string): void
}
