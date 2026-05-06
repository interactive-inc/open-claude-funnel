import { homedir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system";

const defaultFs = new NodeFunnelFileSystem();

export const DEFAULT_FUNNEL_DIR = join(homedir(), ".funnel");

type Props<TConfig> = {
  type: string;
  schema: ZodType<TConfig>;
  fs?: FunnelFileSystem;
  dir?: string;
  /** Set true when the config payload may contain credentials. Files are written with mode 0600. */
  secret?: boolean;
};

export class FunnelJsonConnectorStore<TConfig extends { type: string; name: string }> {
  private readonly type: string;
  private readonly schema: ZodType<TConfig>;
  private readonly fs: FunnelFileSystem;
  private readonly dir: string;
  private readonly secret: boolean;

  constructor(props: Props<TConfig>) {
    this.type = props.type;
    this.schema = props.schema;
    this.fs = props.fs ?? defaultFs;
    const base = props.dir ?? DEFAULT_FUNNEL_DIR;
    this.dir = join(base, "connectors", props.type);
    this.secret = props.secret ?? false;
    Object.freeze(this);
  }

  list(): TConfig[] {
    if (!this.fs.existsSync(this.dir)) return [];

    const files = this.fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const configs: TConfig[] = [];

    for (const file of files) {
      const name = file.slice(0, -5);
      const config = this.get(name);

      if (config) configs.push(config);
    }

    return configs;
  }

  get(name: string): TConfig | null {
    const path = this.pathFor(name);

    if (!this.fs.existsSync(path)) return null;

    const content = this.fs.readFileSync(path);
    const parsed = JSON.parse(content);
    const result = this.schema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `invalid ${this.type} connector "${name}": ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      );
    }

    return result.data;
  }

  has(name: string): boolean {
    return this.fs.existsSync(this.pathFor(name));
  }

  write(config: TConfig): void {
    this.fs.mkdirSync(this.dir, { recursive: true });
    const path = this.pathFor(config.name);
    const data = `${JSON.stringify(config, null, 2)}\n`;

    if (this.secret) this.fs.writeSecretFileSync(path, data);
    else this.fs.writeFileSync(path, data);
  }

  remove(name: string): void {
    if (!this.has(name)) throw new Error(`connector "${name}" not found`);

    this.fs.unlink(this.pathFor(name));
  }

  rename(oldName: string, newName: string): void {
    const config = this.get(oldName);

    if (!config) throw new Error(`connector "${oldName}" not found`);

    if (this.has(newName)) {
      throw new Error(`connector "${newName}" already exists`);
    }

    const renamed = { ...config, name: newName } as TConfig;

    this.write(renamed);
    this.fs.unlink(this.pathFor(oldName));
  }

  pathFor(name: string): string {
    return join(this.dir, `${name}.json`);
  }
}
