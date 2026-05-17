# CLAUDE.md

このリポジトリでコードを扱うときの案内。詳細は対応するソースを直接読むこと。ここは地図に徹する。

## プロジェクト概要

Open Claude Funnel (`funnel` / `fnl`) は、複数の Claude Code エージェントと外部サービス（Slack 等）を統合管理するハブ。外部の通知を購読箱に流し、各 Claude が購読箱経由でイベントを受け取る。

```
Connectors (Slack 等) ─→ Channels (購読箱) ─WebSocket→ Claude (MCP)
```

CLI と TUI、プログラマブル API (`new Funnel(...)`) を 1 つの core から共有する。Web UI は持たない。

## コマンド

```bash
bun install           # 依存インストール（自動ビルドはしない）
make build            # ライブラリ + CLI 一括ビルド
make build-lib        # ライブラリのみ（vp pack）
make build-bin        # CLI / daemon のみ（bun build --minify）
make clean            # dist 削除
bun link              # funnel / fnl をグローバル登録
bunx tsc -b           # 型チェック
bun test              # テスト
bun lib/bin.ts <args> # 開発用直接実行（build 不要、起動 ~2s）
```

`fnl` / `funnel` は `dist/bin.js` を指す bundle。コード変更を `fnl` で確かめるなら `make build` を再実行。日常の試行は `bun lib/bin.ts ...` が速い。

## レイヤ地図

依存は一方向で、内側のレイヤは外側を知らない。

```
engine ← connectors ← gateway ← cli / tui
                                 ↖ bin.ts → funnel.ts (facade)
```

### lib/engine

コアドメイン。他レイヤを知らない。外部境界（FS / HTTP / process / clock / id / logger / settings 等）はすべて abstract class + Node 実装 + Memory 実装で並置し、テストは Memory 実装で書く。主要サービスは channels（購読箱 + nested connector CRUD + schedule entries + adapter dispatch）、claude（起動）、mcp（`.mcp.json` install と stdio サーバ）、profiles、settings。

### lib/connectors

Slack / GitHub / Discord / Schedule の Connector 実装。型ごとに Listener（必須）と Adapter（callable な場合のみ）と Schema を per-file で並置し、`FunnelConnectorFactory` の `switch` で discriminated union を dispatch する。schedule のみ adapter なし。

### lib/gateway

`Bun.serve` で WebSocket と内部管理 API を同一ポートにホストする daemon。listener supervisor、broadcaster、event store、フラットなルート群を抱える。CLI から listener 操作のために `http://localhost:9742` を叩くのは gateway 経由のみ。

### lib/cli

CLI 入口。argv を内部 HTTP リクエストに変換して Hono アプリへ流す。実ネットワークは経由しない。

### lib/tui

OpenTUI ダッシュボード。`fnl`（引数なし）で起動する葉。CLI レイヤ依存なし。

### lib/funnel.ts と lib/bin.ts と lib/index.ts

`funnel.ts` が全 Service を束ねる Facade。`bin.ts` が `package.json` の `bin` エントリ。`index.ts` が公開 API の re-export。

### lib/logger

汎用 LeucoLogger 系。gateway の event store が SQLite sink として利用。

## ランタイムアセット

持続データは `~/.funnel/`、揮発ログは `/tmp/funnel/`。

- `~/.funnel/settings.json` — channels と profiles のみ。channels に connectors を nested で持つ
- `~/.funnel/connectors/<type>/<name>.(json|jsonl)` — Connector 設定は型ごとに分散配置。`schedule` のみ jsonl + `.state.json`
- `~/.funnel/gateway.pid` — daemon の PID
- `~/.funnel/claude/<profile>.pid` — Claude 起動の二重起動防止
- `/tmp/funnel/events/events.db` — SQLite event store（broadcaster の offset を seq として保持、再接続 replay は indexed range scan）
- `/tmp/funnel/funnel.log` — 診断ログ（JSON append）。`fnl gateway logs` が tail する
- `/tmp/funnel/gateway.log` — daemon の stdout/stderr
- Gateway ポート 9742（`FUNNEL_PORT` で変更可）

## 設計原則

### CLI とルーティング

- 対話禁止。すべてオプション引数で完結する（Claude-first）
- ルートファイルは `lib/cli/routes/` 直下にフラット配置。ファイル名は URL パスに 1:1 対応（ドット区切り、動的セグメントは `$param`）。1 URL = 1 file = 1 method を保つ
- CLI verb は read 系（list / show / launch）以外すべて POST に写し、verb は URL セグメントとして残す。Hono は URL で disambiguate する
- help は別ファイルにしない。エンドポイント内で `xxxHelp` を `export` して `zValidator` の第 3 引数に渡し、引数省略形 URL の shortcut route から再利用する
- bin.ts のフォールバックは「404 → `?help=true` 付きで再投 → top-level `HELP`」の二段だけ。プレースホルダ hack は使わない
- CLI フラグは kebab-case のまま zod でバリデートし、ハンドラ層で camelCase に詰め直す。自動ケース変換は入れない
- `--channel <name>` 等の名前は CLI ハンドラ層で id に解決してから engine に渡す。engine 側は id を受け取る
- argv を Claude Code に転送するときは `queryToCliArgs(url, RESERVED_KEYS)` を使う

### ルート規約

- ハンドラに try/catch を書かない。Service は throw、エラー応答は `throw new HTTPException(status, { message })` に統一する。`return c.text("...", 4xx)` 禁止。`lib/cli/routes/index.ts` の onError が捕捉して `error: <message>` で返す
- `c.req.valid("param")` / `c.req.valid("query")` の結果は分割代入せず、`const param = ...` / `const query = ...` として保持する
- Funnel は middleware で context に乗せる。ルートからは `const funnel = c.var.funnel` で取得する
- `export default` 禁止

### モジュールと依存

- ビジネスロジックは engine と connectors のクラスに集約（Hono 非依存）
- クラスは DI（コンストラクタで依存を受け取る）。`Object.freeze(this)` で immutable
- 既存クラスを薄くラップしただけの `createXxxService(store)` 関数は作らない。DI が複数あるときだけ create 関数を置く
- 外部境界は abstract class + Node / Memory 実装を並置。テストは Memory 実装で書く（実 FS / spawn / fetch / WebSocket に触れない）
- 公開 API は `lib/index.ts` で `export * from`。他モジュールから参照されない module-internal な型は元ファイル側で `export` を外す

### Connectors

- Connector は channel に nested で持つ。CRUD は `FunnelChannels` 経由。トップレベルの集約クラスは持たない（型ごとの分散による型安全 dispatch）
- 各型に Listener と Adapter と Schema と EventProcessor を per-file で並置。Factory の `switch` で discriminated union を分岐し、`as` キャストは使わない
- Channel ↔ Profile の双方向依存は `ProfileChannelChecker` / `ProfileChannelRefUpdater` の型で切り、`FunnelChannels` が DI で受け取る
- 新しい Connector 型を足すときは per-type ファイルと factory の `switch` に追加し、MCP に出すなら `channel-server.ts` の `TOOL_CONNECTOR_TYPES` に追記する

### Gateway とライフサイクル

- 同一 `Bun.serve` で WebSocket と内部管理 API（`/health` `/status` `/listeners*` `/channels/.../call`）をホストする
- WebSocket クライアントは `?channel=<name>` で接続し、そのチャネルの connector イベントだけ受信する
- listener は `start(notify)` / `stop()` / `isAlive()` を持ち、`FunnelListenerSupervisor` が registry を所有して 30 秒間隔の health check と exponential backoff（cap 60s）の自動再起動を行う
- 外側からは `Funnel.listeners` が gateway HTTP を叩く。`Funnel.gateway` は daemon プロセス管理だけに専念する
- connector CRUD は store 変更後に listener を hot-reload する。daemon 全体の再起動は不要
- Broadcaster は WS fanout に加えて in-process subscriber を `subscribe(handler)` で受ける。`getBufferedAmount()` が 1 MiB を超えた slow consumer は 1009 で切り捨てる
- Slack Socket Mode 起動時は競合する bun + gateway/bolt/slack プロセスを自 PID 以外 kill する

### Schedule Connector

- cron 5 フィールド + プロンプトを保存し、毎分 tick で発火する
- `lastFiredAt` から逆走してスリープ復帰や daemon 再起動で落ちた分を catch-up 発火する（上限 24 時間）。catch-up は `meta.catchup = "true"` を付ける
- cron 評価は自前実装（`*` / `N` / `A-B` / `*/N` / `A,B` 対応）

### MCP Channel

- Claude Code 側の stdio MCP サーバ
- `FUNNEL_CHANNEL_ID` 未設定なら no-op
- `experimental: { "claude/channel": {} }` capability 必須。対象リポジトリの `.mcp.json` に登録する（`fnl repos add` で自動書き込み）
- 起動時に該当チャネルの connectors を読み、tool 1 つに 1 connector を動的公開する（schedule は除外）。tool 名 = connector 名、引数は `{ method, path, body? }`
- tool 呼び出しは gateway の channel call エンドポイントへ Bearer auth 付き HTTP POST し、レスポンス JSON をそのまま Claude に返す（bash を経由せず）

### TUI と Claude 起動

- `fnl`（引数なし）で OpenTUI ダッシュボード。キーは `r` リフレッシュ、`q` / `esc` / `Ctrl-C` 終了
- `fnl claude` は default profile、`--profile <name>` で名前付き、`--channel <name>` で raw 起動。`--repo` `--sub-agent` `--env-file` を持つ
- `fnl profiles <name> run` は profile を展開した `fnl claude` の糖衣
- 同一 profile 名の二重起動は PID ファイルで拒否する

## コーディング規約

- ランタイムは Bun（ESM）。パスエイリアスは `@/*` → `./lib/*`
- コード、CLI 出力、コメントは英語。ドキュメント（.md）は日本語
- `require()` 禁止。動的 import も禁止
- `let` / `var` を避けて `const` を優先
- 詳細ルールは `.claude/rules/` を参照（TypeScript / React は `ts.react.md`、Git は `git.md`、Markdown は `md.md`）
