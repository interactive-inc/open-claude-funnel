# CLAUDE.md

このリポジトリでコードを扱うときの案内。詳細は対応するソースを直接読むこと。ここは地図に徹する。

## プロジェクト概要

Open Claude Funnel (`funnel` / `fnl`) は、複数の Claude Code エージェントと外部サービス（Slack 等）を統合管理するハブ。外部の通知を購読箱に流し、各 Claude が購読箱経由でイベントを受け取る。

```
Connectors (Slack 等) ─→ Channels (購読箱) ─WebSocket→ Claude (MCP)
```

CLI と TUI、プログラマブル API (`new Funnel(...)`) を 1 つの core から共有する。Web UI は持たない。

## ドメイン語彙

新しい機能を足すときはここで概念の置き場所を決める。

### Channel

購読箱。`{ id, name, delivery, connectors[] }` を持ち、複数の Connector を nest する単位。WS クライアントはチャネル名で subscribe する。`delivery` は 2 種類。

- `fanout` — 全 subscriber が全 event を受信する。各 subscriber が独立した仕事を持つ場合（複数 Profile が同じ source を別々に処理する、TUI が観察するなど）
- `exclusive` — 1 event を 1 subscriber が round-robin で消費する。subscriber が交換可能な worker で、各 event を 1 回だけ処理させたい場合
- `tap=all`（TUI 等の観察用クライアント）は delivery mode に関係なく常に全部受信する

### Connector

外部サービスとの 1 つの接続。`slack` / `gh` / `discord` / `schedule` の 4 型。Channel に nested で持つ（1 Channel に複数 Connector）。型ごとの内訳：

- Listener — 外部 → Funnel の入口。push（Slack Socket Mode）か pull（GitHub poll）か tick（Schedule cron）かは型による
- Adapter — Claude → 外部の出口（callable な型のみ。schedule にはない）
- Schema / EventProcessor — 設定と event 整形

### Profile

1 つの Claude 起動設定。`{ name, path, subAgent, channelId }` の束。`fnl claude --profile <name>` で path（cwd）に移動し、sub-agent を選び、`FUNNEL_CHANNEL_ID` を注入して Claude を起動する。Profile 自身は Connector を持たない（Channel が持つ）。

### Listener Supervisor と Broadcaster

gateway 内に常駐する 2 つの裏方。Supervisor は Listener の起動 / 停止 / 自動再起動を管理する registry。Broadcaster は notify を受け取って WS クライアントに fanout し、event store に seq を打って永続化する。

### イベントの旅

1 つの Slack メッセージが Claude に届くまで。

```
Slack → SlackListener.start(notify) → notify(channel, connector, content, meta)
     → GatewayServer.notify → Broadcaster.broadcast → event store に seq 付き保存
     → 該当 Channel を subscribe している WS クライアントに fanout
     → Claude 側 MCP（channel-server）が受信して Claude に events として渡す
```

逆方向（Claude → Slack）は MCP の per-connector tool 経由。Claude が tool を呼ぶ → MCP サーバが gateway の channel call エンドポイントに HTTP POST → `FunnelChannels.call()` → Adapter → Slack。Listener と Adapter は独立した一方向の通路で、Broadcaster は経由しない。

### gateway の要否

`fnl channels add` 等の store 編集系は gateway なしでも動く。Listener を起動するもの（実イベントを流す）と WS で受け取るもの（MCP / TUI 観察）だけが gateway を必要とする。store 編集後に gateway が動いていれば、対応する Listener を hot-reload する。

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

## Storage 規約

ファイル一覧そのものは README.md の File layout を参照。ここには Claude が新規に永続データを足すときの判断ルールだけを置く。

- 永続データは `~/.funnel/` 配下、揮発ログ / イベントストアは `/tmp/funnel/` 配下に置く
- パスはハードコードせず、各モジュールが `FUNNEL_DIR`（または DI された `dir` / `tmpDir`）から `join` で構築する。Memory 実装でテストできるようにするため
- Connector の per-instance な永続 state は `channels/<channel-id>/connectors/<connector-id>/` 配下に置く。id ベースで切るので rename しても追従する。name ベースで切らない
- Connector の「設定」は settings.json に nested で入れる、「state」だけ上のディレクトリに分ける。設定と state を同じ場所に混ぜない
- daemon 系の揮発ファイル（pid / token 等）は `~/.funnel/` 直下に置く
- Gateway ポートは 9742（`FUNNEL_PORT` で変更可）

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

二系統を 1 つの stdio MCP サーバで提供する。受信（events）と送信（tools）は実装も方向も別。

- 受信系 — gateway に WS 接続してイベントを Claude に流す。`FUNNEL_CHANNEL_ID` 未設定なら no-op。`experimental: { "claude/channel": {} }` capability 必須。対象リポジトリの `.mcp.json` に登録する（`fnl repos add` で自動書き込み）
- 送信系 — 起動時に該当チャネルの connectors を読み、tool 1 つに 1 connector を動的公開する（schedule は除外）。tool 名 = connector 名、引数は `{ method, path, body? }`。tool 呼び出しは gateway の channel call エンドポイントへ Bearer auth 付き HTTP POST し、レスポンス JSON をそのまま Claude に返す（bash を経由しない）

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
