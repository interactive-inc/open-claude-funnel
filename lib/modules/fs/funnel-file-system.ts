export type FileStat = {
  mtimeMs: number
}

export abstract class FunnelFileSystem {
  abstract existsSync(path: string): boolean
  abstract readFileSync(path: string): string
  abstract writeFileSync(path: string, data: string): void
  abstract appendFileSync(path: string, data: string): void
  abstract unlink(path: string): void
  abstract mkdirSync(path: string, options?: { recursive?: boolean }): void
  abstract readdirSync(path: string): string[]
  abstract statSync(path: string): FileStat
}
