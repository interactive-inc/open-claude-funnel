# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Claude Funnel (`funnel` / `fnl`) は、複数の Claude Code エージェントと外部サービス（Slack 等）を統合管理するハブ。外部の通知が購読箱に流れ、各 Claude が購読箱経由でイベントを受け取る。

```
Connectors (Slack 等) ─→ Channels (購読箱) ─WebSocket→ Claude (MCP)
```

## Commands

```bash
bun install          # 依存インストール（postinstall で `bun run build` が走り dist/bin.js が生成される）
bun run build        # CLI バンドル再生成（lib/bin.ts → dist/bin.js, ~4MB minified）
bun link             # funnel / fnl をグローバル登録（dist/bin.js を symlink）
bunx tsc -b          # 型チェック
bun test             # テスト実行
bun lib/bin.ts <args># 開発用直接実行（build なしで即時。ただし起動 ~2s）
```

`fnl` / `funnel` は `dist/bin.js`（minify した bundle）を指す。コード変更後に `fnl` 経由で動作確認するなら `bun run build` を再実行すること。日常の試行は `bun lib/bin.ts ...` で直接動かすのが速い。

## Architecture

CLI の引数を内部 HTTP リクエストに変換し、Hono アプリでルーティングする構造。実際のネットワーク通信は発生しない（gateway daemon が走っている時だけ、CLI が listener 操作のために `http://localhost:9742` を叩く）。

レイヤは厳密な一方向依存：

```
index.ts ─→ funnel.ts ─→ {engine, connectors, gateway}    bin.ts ─→ funnel.ts
                                                                  ─→ {engine, connectors, gateway, cli, tui}
gateway ─→ {connectors, engine}
connectors ─→ engine
engine ─→ (プロジェクト内には依存しない)
```

UI は CLI の TUI（OpenTUI）のみ。Web UI は廃止済み。

ディレクトリ：

```
lib/
├── index.ts             公開 API の re-export（`export * from` で全モジュールを束ねる）
├── funnel.ts            Funnel facade（全 facet を束ねる）
├── bin.ts               CLI バイナリエントリ（package.json `bin`）。argv → toRequest → app.request → stdout
│
├── engine/              コアドメイン。他レイヤを知らない
│   ├── channels/        FunnelChannels（購読箱）+ ConnectorExistenceChecker 型
│   ├── claude/          FunnelClaude + GatewayController 型（gateway 依存を切る）
│   ├── mcp/             FunnelMcp + channel-server（stdio）
│   ├── profiles/        FunnelProfiles + ProfileChannel{Checker,RefUpdater} 型
│   ├── repos/           FunnelRepositories
│   ├── settings/        FunnelSettingsReader/Store + Zod スキーマ + Mock
│   ├── fs/              FunnelFileSystem (abstract) + Node / Memory 実装
│   ├── http/            FunnelHttpClient (abstract) + Node / Memory 実装
│   ├── process/         FunnelProcessRunner (abstract) + Node / Memory 実装
│   ├── logger/          FunnelLogger (abstract) + Node / Memory / Noop 実装
│   ├── time/            FunnelClock (abstract) + Node / Memory 実装
│   └── id/              FunnelIdGenerator (abstract) + Node / Memory 実装
│
├── logger/              LeucoLogger 系（独立した汎用 logger）。`gateway/funnel-event-store.ts` が SQLite sink として利用
├── tui/                 OpenTUI ダッシュボード（`bin.ts` から `launchTui(funnel)` で起動）
│
├── connectors/          コネクタ実装。engine のみに依存
│                        FunnelConnectors (facade) + per-type
│                        Store/Listener/Adapter/EventProcessor + FunnelSchedule
│
├── gateway/             Web サーバ。connectors / engine に依存
│   ├── gateway.ts                 daemon manager (PID + nohup)
│   ├── gateway-server.ts          Bun.serve embedding (HTTP + WS)
│   ├── listener-supervisor.ts     registry + health check
│   ├── listeners-client.ts        HTTP client to running daemon
│   ├── broadcaster.ts             WS fanout + subscribers + backpressure
│   ├── funnel-event-store.ts      SQLite event store (LeucoLoggerSqliteSink wrapper)
│   ├── kill-competing-slack-gateways.ts
│   ├── daemon.ts                  bun daemon entry
│   └── routes/                    フラットな daemon 内部 API ルート（dotted name）
│       ├── index.ts               gatewayRoutes（最上位 mount）
│       ├── health.ts              GET  /health
│       ├── status.ts              GET  /status
│       ├── listeners.list.ts      GET    /listeners
│       ├── listeners.start.ts     POST   /listeners/:channel/:connector/start
│       ├── listeners.stop.ts      DELETE /listeners/:channel/:connector
│       ├── listeners.restart.ts   POST   /listeners/:channel/:connector/restart
│       ├── route-deps.ts          GatewayRouteDeps 型
│       └── validator.ts           zParam helper
│
└── cli/                 CLI 機構。全レイヤに依存（bin.ts 経由で利用）
    ├── factory.ts       Hono factory
    ├── routes/          フラットなルートハンドラ群（URL パスベース命名 / `$param` で動的セグメント / 1 URL = 1 file = 1 method）
    │   ├── index.ts                                                          app（middleware + onError + flat mount + 引数省略時の help shortcut）
    │   ├── channels.ts                                                       GET /channels
    │   ├── channels.$channel.ts                                              GET /channels/:channel (show)
    │   ├── channels.add.$channel.ts                                          POST add
    │   ├── channels.remove.$channel.ts                                       POST remove
    │   ├── channels.$channel.rename.$newName.ts                              POST rename
    │   ├── channels.$channel.set.delivery.$mode.ts                           POST set delivery
    │   ├── channels.$channel.connectors.ts                                   GET list
    │   ├── channels.$channel.connectors.$connector.ts                        GET show
    │   ├── channels.$channel.connectors.add.$connector.ts                    POST add
    │   ├── channels.$channel.connectors.set.$connector.ts                    POST set
    │   ├── channels.$channel.connectors.remove.$connector.ts                 POST remove
    │   ├── channels.$channel.connectors.$connector.rename.$newName.ts        POST rename
    │   ├── channels.$channel.connectors.$connector.request.ts                POST request
    │   ├── channels.$channel.connectors.$connector.schedules.ts              GET list
    │   ├── channels.$channel.connectors.$connector.schedules.add.$id.ts      POST add
    │   ├── channels.$channel.connectors.$connector.schedules.remove.$id.ts   POST remove
    │   ├── claude.ts / status.ts / update.ts                                 GET
    │   ├── gateway.ts                                                        group + 共通 fetch 関数（status と共有）
    │   ├── gateway.{status,start,stop,restart,run,logs,listeners}.ts         GET
    │   ├── profiles.ts                                                       GET list
    │   ├── profiles.add.$profile.ts / profiles.set.$profile.ts / profiles.remove.$profile.ts   POST
    │   ├── profiles.$profile.run.ts                                          GET run（`/profiles/:profile` GET にも alias）
    │   └── profiles.$profile.rename.$newName.ts / profiles.$profile.as-default.ts              POST
    └── router/          toRequest / queryToCliArgs / zValidator
```

## Design Rules

### CLI

- 対話禁止。全てオプション引数で完結する（Claude-first）
- `export default` 禁止
- ルートファイルは `lib/cli/routes/` 直下にフラット配置。ファイル名は URL パスに 1:1 対応（ドット区切り、動的セグメントは `$param`、verb は CLI と同じ綴りでセグメント化）。例: `channels.$channel.connectors.add.$connector.ts` ↔ `POST /channels/:channel/connectors/add/:connector`。1 URL = 1 file = 1 method を保ち、ファイルを跨いだ method 多重を作らない（rename の語順 alias のみ bundler 側で同じ handler を 2 URL に登録する）
- help は別ファイルにせず、エンドポイントのファイル内に `export const xxxHelp = \`...\`` で定義して `zValidator(..., xxxHelp)` の第3引数に渡す。`export` するのは shortcut 経由で bundler が再利用するため
- 引数を省略した呼び出し（例 `funnel channels add`）は bundler の shortcut route が `?help=true` 不要で help を返す。具体的には `:param` 省略形の URL（`POST /channels` / `DELETE /channels/:channel/connectors` 等）に `helpRoute(xxxHelp)` を登録する
- bin.ts のフォールバックは `?help=true` 付きでルートが 404 のとき `GET /<group>?help=true` → 最後に top-level `HELP` 文字列、の二段だけ。`_help_` プレースホルダ等の hack は使わない
- CLI verb → HTTP method 変換（`lib/cli/router/to-request.ts`）: 全 verb が **POST** にマップされ、verb は URL セグメントとして残る。Hono は URL で disambiguate する（メソッド意味論に依存しない）
  - `add` / `remove` / `set` / `rename` / `as-default` / `request` のいずれも POST + verb in URL
  - `funnel channels add foo` → `POST /channels/add/foo`
  - `funnel channels remove foo` → `POST /channels/remove/foo`
  - `funnel channels foo set delivery fanout` → `POST /channels/foo/set/delivery/fanout`
  - `funnel channels rename old new` / `funnel channels old rename new` の双方向 URL を bundler で alias 登録
- read 系（list / show / launch）は引数に verb が出ないので GET のまま
- CLI フラグは kebab-case で受け取り、zod スキーマも kebab key（`"bot-token"`, `"poll-interval"`, `"sub-agent"`, `"catchup-policy"` 等）でバリデートしてからハンドラ側で camelCase に詰め直す。スキーマ key と CLI 表記を一致させる（自動ケース変換は入れない）
- CLI から渡される `--channel <name>` 等は CLI ハンドラ層で id/internal value に解決してから engine に渡す（engine 側は id を期待。例: profiles の `channelId` は `funnel.channels.get(name).id` 経由で解決）

### Modules

- ビジネスロジックは `lib/engine/` `lib/connectors/` のクラスに集約（Hono 非依存）。一方向依存：engine ← connectors ← gateway ← cli、ui は gateway が消費する葉
- `Funnel` class（`lib/funnel.ts`）が全 Service を束ねる Facade。プログラマブル API としても `new Funnel({ store })` で利用可
- クラスは DI（コンストラクタで依存を受け取る）
- `Object.freeze(this)` で immutable
- CLI と TUI は `Funnel` 経由で同じ API を共有
- `new ConnectorService({ store })` を薄くラップしただけの `createXxxService(store)` 関数は作らない（DI が複数になる場合のみ create 関数を置く）
- 外部境界（FS / HTTP / process / settings / adapter / listener）は abstract class を切り、Node 実装と Memory 実装を並置
- テストは Memory 実装で書く（実 FS / spawn / fetch / WebSocket に触れない）
- ルートハンドラでは try/catch を書かない。サービスは throw、エラー応答も `throw new HTTPException(status, { message })` で統一する（`return c.text("...", 4xx)` 禁止）。`lib/cli/routes/index.ts` の onError が捕捉して `error: <message>` で返す
- ルートで `c.req.valid("param")` / `c.req.valid("query")` の結果は分割代入せず、`const param = ...` / `const query = ...` として保持する
- ルートは `const funnel = c.var.funnel` で Funnel を取得して使う（`lib/cli/routes/index.ts` の base app に付けた `use("*", ...)` middleware で context に乗せる）
- CLI 経由で実行 argv を Claude Code に転送するときは `queryToCliArgs(url, RESERVED_KEYS)` を使い、funnel 自身の予約キーを除外する
- 公開 API は `lib/index.ts` で `export * from` で集約。型を public にするかは「他モジュールから参照されるか」で判定し、参照のない module-internal な型（例: `AddConnectorInput`, `BroadcasterMetrics`, `ConnectorRegistry` 系の supervisor scaffolding）は元ファイル側で `export` を外す。ファイル間で共有する型は `export` のまま残す

### Settings

- ディレクトリ: `~/.funnel/`
- パス: `~/.funnel/settings.json`（channels / profiles / repositories のみ）
- スキーマ: `lib/engine/settings/settings-schema.ts`（Zod v4）。型は `z.infer` で生成
- Slack トークンは `xoxb-` / `xapp-` プレフィックスで検証
- Connector 設定は settings.json には入れず、per-type ディレクトリに分散（下の Connectors 参照）

### Connectors

- データ配置: `~/.funnel/connectors/<type>/<name>.(json|jsonl)` — 型ごとに独立、新しい型の追加/廃止はその配下のみで完結
  - `slack/<name>.json` — `{type, name, botToken, appToken}`
  - `gh/<name>.json` — `{type, name, pollInterval?}`
  - `discord/<name>.json` — `{type, name, botToken}`
  - `schedule/<name>.jsonl` — 1 行 1 エントリ `{id, cron, prompt, enabled}`
  - `schedule/<name>.state.json` — 発火済みエントリの lastFiredAt（catch-up 用）
- 抽象階層は 2 段。listener-only は `FunnelConnectorTypeStore<TConfig>`、adapter を持つ callable 型（slack / gh / discord）は `FunnelCallableConnectorStore<TConfig>` を継承して `createAdapter` を実装する。schedule は前者のみで、`createAdapter` はそもそも存在しない（ランタイムの `null` 返しや type 防御コードは書かない）
- `FunnelConnectors`（facade）は typed fields（`slack` / `gh` / `discord` / `schedule`）＋ `ChannelConnectorRefUpdater` を DI で受け取り、discriminated union の `switch` で dispatch する。`as` キャストは一切使わない。フィールド更新と adapter 経由の API は型ごとに分かれる（`updateSlack` / `updateGh` / `updateDiscord` と `callSlack` / `callGh` / `callDiscord`）
- Channel ↔ Connector の双方向依存は `ConnectorExistenceChecker`（channels → connectors）と `ChannelConnectorRefUpdater`（connectors → channels）の型だけで切る。`Funnel` は forward-const クロージャで遅延ワイヤリング
- Channel ↔ Profile も同様に `ProfileChannelChecker` / `ProfileChannelRefUpdater`（`lib/engine/profiles/`）の型で切り、`FunnelChannels` が DI で受け取る。`FunnelProfiles` がこれらの interface を実装する
- 新しい Connector 型を足すときは `xxx-connector-schema.ts` / `xxx-store.ts` / `xxx-listener.ts`（callable なら adapter も）を作り `FunnelConnectors` に一フィールド追加 + `createConnectorStores()` に登録。廃止はその逆で完結
- 旧 `settings.json` の `connectors[]` は起動時に `migrateLegacyConnectors` が per-type ファイルへ書き出してフィールドを除去する（冪等）

### Schedule Connector

- `lib/connectors/schedule.ts` — エントリ CRUD は `FunnelSchedule` サービスが担う。`FunnelConnectors` には schedule 専用メソッドを置かない
- cron 式（5 フィールド）とプロンプトを保存し、毎分 tick で発火してチャネルへ notify する
- `FunnelScheduleListener` は tick ごとに `schedule/<name>.state.json` の `lastFiredAt` を読み、`(lastFired + 1min)` から now まで逆走して最も新しいマッチング分を 1 回だけ発火する。スリープ復帰や daemon 再起動で落ちた分を拾う（上限 24 時間）。catch-up 発火には `meta.catchup = "true"` を付ける
- エントリ CRUD は `fnl connectors <name> schedules add|remove` サブコマンド（URL は `/connectors/<name>/schedules[/<id>]`）
- cron 評価は `lib/connectors/match-cron.ts` の自前実装（`*` / `N` / `A-B` / `*/N` / `A,B` 対応）

### Gateway

- ポート: 9742（`FUNNEL_PORT` で変更可）
- PID: `~/.funnel/gateway.pid`
- イベントストア: `/tmp/funnel/events/events.db` — SQLite。broadcaster の `offset` を seq として保持、`channel_id` / `connector_id` を indexed カラム。再接続 replay は `WHERE seq > ?` の indexed range scan
- 診断ログ: `/tmp/funnel/funnel.log` — `NodeFunnelLogger` が gateway ライフサイクル / 接続切断 / listener 起動を JSON で append。`funnel gateway logs` がこれを tail する
- プロセスログ: `/tmp/funnel/gateway.log` — daemon の stdout/stderr
- `nohup` でバックグラウンド起動
- 同一 `Bun.serve` で WebSocket（`/ws`）と内部管理 API（`/health` `/status` `/listeners*`）をホストする
- WebSocket クライアントは `?channel=<name>` で接続し、そのチャネルが購読する Connector のイベントのみ受信
- Slack Socket Mode 起動時は、競合する bun + gateway/bolt/slack プロセスを自 PID 以外 kill する

### Listener Lifecycle

- 各 listener は `start(notify)` / `stop()` / `isAlive()` を持つ。`FunnelListenerSupervisor`（gateway 配下）が name → running listener の registry を所有し、起動／停止／再起動／health check を一元管理
- supervisor は 30 秒間隔で `isAlive()` を呼び、dead と判定した listener を exponential backoff（1s, 2s, 4s, ... cap 60s）で自動再起動
- gateway HTTP に `GET /listeners` `POST /listeners/:name/start` `DELETE /listeners/:name` `POST /listeners/:name/restart` がある
- 外側からは `Funnel.listeners`（FunnelListenersClient）が gateway HTTP を叩く。`Funnel.gateway` は daemon プロセス管理だけに専念（`isRunning` / `start` / `stop` / `restart`）
- `fnl connectors add/remove/rename/set` は store を変更後、gateway が動いてれば `funnel.listeners.start/stop/restart` を呼んで hot-reload する。daemon 全体の再起動は不要

### Broadcaster

- `FunnelBroadcaster` は WS クライアントへの fanout に加え、in-process subscriber を `subscribe(handler)` で登録できる（programmable API 用）
- backpressure: `ws.getBufferedAmount()` が閾値（既定 1 MiB）を超えた WS クライアントは 1009 で close + registry から除外。一人の slow consumer が daemon 全体を遅らせるのを防ぐ

### MCP Channel

- `lib/engine/mcp/channel-server.ts` — Claude Code の stdio MCP サーバ
- `FUNNEL_CHANNEL_ID` が未設定なら WebSocket 接続しない（no-op）
- `experimental: { "claude/channel": {} }` capability 必須
- 対象リポジトリの `.mcp.json` に登録が必要（`fnl repos add` で自動書き込み）

### TUI

- `fnl`（引数なし）で OpenTUI のダッシュボードが起動（connectors / channels / profiles / gateway 状態 / listener alive・dead）
- キー: `r` でリフレッシュ、`q` / `esc` / `Ctrl-C` で終了
- `lib/cli/tui/{tui,app}.tsx`。OpenTUI は React の JSX runtime を `@opentui/react` 経由で使う（pragma で指定）
- ブラウザ向け Web UI は廃止

### Claude 起動

- `fnl claude` は "default" profile を起動。`fnl claude --profile <name>` で名前付き profile を起動
- `fnl claude --channel <name>` で profile を使わない raw 起動（`FUNNEL_CHANNEL_ID=<name>` を子プロセスに注入）
- `--repo <name>` で cwd を切り替え（おまけ）
- `--sub-agent <name>` で `claude --agent` に伝播
- `--env-file <file>` で追加 env 読込
- `fnl profiles <name> run` はプロファイルを展開した `fnl claude` の糖衣
- 同一 profile 名で起動中は二重起動を拒否。PID ファイル: `~/.funnel/claude/<name>.pid`

## Conventions

- ランタイム: Bun（ESM）
- パスエイリアス: `@/*` → `./lib/*`
- 言語: コード・CLI 出力・コメントは英語。ドキュメント (.md) は日本語
- `require()` 禁止。動的 import も禁止
- `let` / `var` 回避、`const` 優先
