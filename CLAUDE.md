# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Claude Funnel (`funnel` / `fnl`) は、複数の Claude Code エージェントと外部サービス（Slack 等）を統合管理するハブ。外部の通知が購読箱に流れ、各 Claude が購読箱経由でイベントを受け取る。

```
Connectors (Slack 等) ─→ Channels (購読箱) ─WebSocket→ Claude (MCP)
```

## Commands

```bash
bun install          # 依存インストール
bun link             # funnel / fnl をグローバル登録
bunx tsc -b          # 型チェック
bun test             # テスト実行
```

## Architecture

CLI の引数を内部 HTTP リクエストに変換し、Hono アプリでルーティングする構造。実際のネットワーク通信は発生しない（gateway daemon が走っている時だけ、CLI が listener 操作のために `http://localhost:9742` を叩く）。

レイヤは厳密な一方向依存：

```
api.ts ─→ funnel.ts ─→ {engine, connectors, gateway}    cli ─→ funnel.ts
                                                                ─→ {engine, connectors, gateway}
gateway ─→ {connectors, engine}
connectors ─→ engine
engine ─→ (プロジェクト内には依存しない)
```

UI は CLI の TUI（OpenTUI）のみ。Web UI は廃止済み。

ディレクトリ：

```
lib/
├── api.ts               公開 API の re-export
├── funnel.ts            Funnel facade（全 facet を束ねる）
├── index.ts             CLI バイナリエントリ。argv → app.request()
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
├── connectors/          コネクタ実装。engine のみに依存
│                        FunnelConnectors (facade) + per-type
│                        Store/Listener/Adapter/EventProcessor + FunnelSchedule
│
├── gateway/             Web サーバ。connectors / engine / ui に依存
│   ├── gateway.ts                 daemon manager (PID + nohup)
│   ├── gateway-server.ts          Bun.serve embedding (HTTP + WS)
│   ├── listener-supervisor.ts     registry + health check
│   ├── listeners-client.ts        HTTP client to running daemon
│   ├── broadcaster.ts             WS fanout + subscribers + backpressure
│   ├── funnel-event-store.ts      SQLite event store (LeucoLoggerSqliteSink wrapper)
│   ├── kill-competing-slack-gateways.ts
│   ├── daemon.ts                  bun daemon entry
│   └── routes/                    Hono ルート（CLI と対称）
│       ├── health-route.ts        GET  /health
│       ├── status-route.ts        GET  /status
│       ├── hello-route.ts         GET  /api/hello
│       ├── route-deps.ts          GatewayRouteDeps 型
│       ├── routes.ts              buildGatewayRoutes（最上位）
│       └── listeners/
│           ├── list-route.ts      GET    /listeners
│           ├── start-route.ts     POST   /listeners/:name/start
│           ├── stop-route.ts      DELETE /listeners/:name
│           ├── restart-route.ts   POST   /listeners/:name/restart
│           └── routes.ts          listenersRoutes（mount）
│
└── cli/                 CLI 機構。全レイヤに依存
    ├── factory.ts       Hono factory
    ├── routes.ts        sub-Hono の mount
    ├── routes/          ルートハンドラ（connectors / channels / claude /
    │                    gateway / profiles / repos / request /
    │                    status / update）
    ├── router/          toRequest / queryToCliArgs / zValidator
    └── tui/             OpenTUI ダッシュボード（fnl 引数なしで起動）
```

## Design Rules

### CLI

- 対話禁止。全てオプション引数で完結する（Claude-first）
- `export default` 禁止
- ルートは `?help=true` に対してヘルプテキストを返すのが原則。`index.ts` 側で「ルートが該当しない / メソッドが合わない」場合は同 path の GET、続いてグループ help にフォールバックする
- CLI verb は `lib/cli/router/to-request.ts` で HTTP method に変換される（`add` → POST, `remove` → DELETE, `set` → PUT, `rename` / `attach` → PUT, `detach` → DELETE）。GET 専用ではない

### Modules

- ビジネスロジックは `lib/engine/` `lib/connectors/` のクラスに集約（Hono 非依存）。一方向依存：engine ← connectors ← gateway ← cli、ui は gateway が消費する葉
- `Funnel` class（`lib/funnel.ts`）が全 Service を束ねる Facade。プログラマブル API としても `new Funnel({ store })` で利用可
- クラスは DI（コンストラクタで依存を受け取る）
- `Object.freeze(this)` で immutable
- CLI と TUI は `Funnel` 経由で同じ API を共有
- `new ConnectorService({ store })` を薄くラップしただけの `createXxxService(store)` 関数は作らない（DI が複数になる場合のみ create 関数を置く）
- 外部境界（FS / HTTP / process / settings / adapter / listener）は abstract class を切り、Node 実装と Memory 実装を並置
- テストは Memory 実装で書く（実 FS / spawn / fetch / WebSocket に触れない）
- ルートハンドラでは try/catch を書かず、サービスは throw。`lib/cli/routes.ts` の onError が捕捉して 400 テキストで返す
- ルートで `c.req.valid("param")` / `c.req.valid("query")` の結果は分割代入せず、`const param = ...` / `const query = ...` として保持する
- ルートは `const funnel = c.var.funnel` で Funnel を取得して使う（`lib/cli/routes.ts` の base app に付けた `use("*", ...)` middleware で context に乗せる。sub-Hono の `factory` には initApp を設定しないこと — 二重生成を避けるため）
- CLI 経由で実行 argv を Claude Code に転送するときは `queryToCliArgs(url, RESERVED_KEYS)` を使い、funnel 自身の予約キーを除外する

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
