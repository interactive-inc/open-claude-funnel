# CLAUDE.md

このリポジトリでコードを扱うときの案内。詳細は対応するソースを直接読むこと。ここは地図に徹する。

## プロジェクト概要

Open Claude Funnel (`funnel` / `fnl`) は、複数の Claude Code エージェントと外部サービス（Slack 等）を統合管理するハブ。外部の通知を購読箱に流し、各 Claude が購読箱経由でイベントを受け取る。

```
external sources → daemon → channel → agent (MCP)
                       ↑ ← outbound replies (MCP tools)
```

CLI と TUI、プログラマブル API (`new Funnel(...)`) を 1 つの core から共有する。Web UI は持たない。

## ドメイン語彙

新しい機能を足すときはここで概念の置き場所を決める。

### Channel

購読箱（transport）。`{ id, name, delivery, connectors[] }` を持ち、複数の Connector を nest する単位。WS クライアントはチャネル名で subscribe する。Channel は「event がどこから来てどこへ返るか」だけを持ち、launch 設定（options/env/resume）は持たない（それは Profile の責務）。`delivery` は 2 種類。

- `fanout` — 全 subscriber が全 event を受信する。各 subscriber が独立した仕事を持つ場合（複数 Profile が同じ source を別々に処理する、TUI が観察するなど）
- `exclusive` — 1 event を 1 subscriber が round-robin で消費する。subscriber が交換可能な worker で、各 event を 1 回だけ処理させたい場合
- `tap=all`（TUI 等の観察用クライアント）は delivery mode に関係なく常に全部受信する

### Connector

外部サービスとの 1 つの接続。`slack` / `gh` / `discord` / `schedule` の 4 型。Channel に nested で持つ（1 Channel に複数 Connector）。型ごとの内訳：

- Listener — 外部 → Funnel の入口。push（Slack Socket Mode）か pull（GitHub poll）か tick（Schedule cron）かは型による
- Adapter — Claude → 外部の出口（callable な型のみ。schedule にはない）
- Schema / EventProcessor — 設定と event 整形

### Profile

transport model（Channel + Connector）の外側にある launch 便宜レイヤ。起動に必須ではなく（`fnl claude --channel <name>` だけで起動できる）、preset を保存しておきたいときだけ使う。machine-global な Claude 起動 preset で、`{ id, name, path, channelId, options[], env, resume, sessionId? }` で `~/.funnel/settings.json` に nested。`id` は不変の uuid 主キー（rename しても追従させたい内部 state — PID ファイルと sessionId — のキー）、`name` は CLI/TUI が指す表示用ラベルで rename 可能（`--profile <name>`）。`fnl claude --profile <name>` で path（cwd）に移動し、`FUNNEL_CHANNEL_ID` を注入して Claude を起動する。launch 固有の設定 — `--agent` / `--brief` / `--model` などの `options`（claude argv の先頭に積む）、`env`（process.env が衝突時に勝つ）、`resume`（session 再利用の可否）— は全部 Profile が持つ。`sessionId` は config でなく execution state で、この profile が最後に起動した Claude session id（launcher が書き、次回 resume で読む）。session を profile（by id）に内包することで、同じ repo の無関係な session を引き継がず、transport 層（Channel）は profile / session を一切知らずに済む。Profile 自身は Connector を持たない（Channel が持つ）。Profile は channel を内包するので `--profile` と `--channel` は併用不可（同時指定は error）。

### LocalConfig（funnel.json）

リポジトリ直下の `funnel.json`。channels[]（transport）と profiles[]（launch recipe）を宣言してリポジトリと一緒に commit する。

```
LocalConfig = { channels: ChannelSpec[], profiles?: ProfileSpec[] }
ChannelSpec = { name, connectors? }
ProfileSpec = { channel, options?, env?, resume? }
```

`fnl claude` は global `--profile` が無ければ cwd の funnel.json を読み、`--channel <name>` で channels[] から選ぶ（無指定なら先頭）。選択 channel の `connectors` は launch 時に `~/.funnel/settings.json` の Channel に sync される（transport のみ）。recipe は「その channel に bound な profiles[] の先頭」を inline で launch に渡す（global profile への永続化はしない）。token フィールドは literal / `env.<field>` 経由の env-var 参照 / TTY プロンプトで解決される。詳細は `lib/engine/local-config/` を参照。

### Listener Supervisor と Broadcaster

gateway 内に常駐する 2 つの裏方。Supervisor は Listener の起動 / 停止 / 自動再起動を管理する registry。Broadcaster は notify を受け取って WS クライアントに fanout し、`FunnelEventLog`（永続 replay log の port）に offset を打って永続化する。EventLog は差し替え可能な port で、default は `SqliteFunnelEventLog`、test / 軽量 embedder 向けに `MemoryFunnelEventLog` がある（CLAUDE.md 末尾の Gateway 節参照）。

### イベントの旅

1 つの Slack メッセージが Claude に届くまで。

```
Slack → SlackListener.start(notify) → notify(channel, connector, content, meta)
     → GatewayServer.notify → Broadcaster.broadcast → event store に seq 付き保存
     → 該当 Channel を subscribe している WS クライアントに fanout
     → Claude 側 MCP（channel-server）が受信して Claude に events として渡す
```

逆方向（Claude → Slack）は MCP の per-connector tool 経由。Claude が tool を呼ぶ → MCP サーバが gateway の channel call エンドポイントに HTTP POST → `FunnelChannels.call()` → Adapter → Slack。Listener と Adapter は独立した一方向の通路で、Broadcaster は経由しない。outbound も gateway が要る点に注意（HTTP hop）。

### gateway の要否

`fnl channels add` 等の store 編集系は gateway なしでも動く。Listener を起動するもの（実イベントを流す）、WS で受け取るもの（MCP / TUI 観察）、outbound（Claude → external も HTTP hop 経由）が gateway を必要とする。store 編集後に gateway が動いていれば、対応する Listener を hot-reload する（ただし `FunnelLocalConfigSync` の rename-by-token 経路は engine の `FunnelChannels.renameConnector` を直叩きするので reload が走らない — `fnl gateway restart` で取り込む）。

## コマンド

```bash
bun install           # 依存インストール（自動ビルドはしない）
make build            # ライブラリ + CLI + JSON Schema 一括ビルド
make build-lib        # ライブラリのみ（vp pack）
make build-bin        # CLI / daemon のみ（bun build --minify）
make schema           # funnel.schema.json を root と public/schema.json に再生成
make clean            # dist 削除
bun link              # funnel / fnl をグローバル登録
bunx tsc -b           # 型チェック
make test             # テスト全実行（bun test）
bun lib/bin.ts <args> # 開発用直接実行（build 不要、起動 ~2s）
```

`fnl` / `funnel` は `dist/bin.js` を指す bundle。コード変更を `fnl` で確かめるなら `make build` を再実行。日常の試行は `bun lib/bin.ts ...` が速い。

テストファイルは全て `.test.ts`（TUI は `.test.tsx`）で統一し、`bun test` 一本で走らせる（`make test` = `bun test`）。テストランナーは Bun ネイティブの `bun:test`（`import { describe, expect, test, mock } from "bun:test"`）。production と同じ Bun ランタイムで実行するので、`Bun.serve` / `bun:sqlite` を import チェーンに含む統合テストも普通に動く（vitest の Node ワーカー時代に必要だった exclude リストの二重管理は廃止）。mock は `mock(fn)`（旧 `vi.fn`）、module mock は `mock.module(specifier, factory)`（旧 `vi.mock`、bun では hoist されて static import を intercept する）。新規テストは `bun:test` から import するだけでよい。`@/` alias は tsconfig の `paths` から解決される。

## レイヤ地図

依存は一方向で、内側のレイヤは外側を知らない。

```
engine ← connectors ← gateway ← cli / tui
                                 ↖ bin.ts → funnel.ts (facade)
```

### lib/engine

コアドメイン。他レイヤを知らない。外部境界（FS / HTTP / process / clock / id / logger / settings / token prompter 等）はすべて abstract class + Node 実装 + Memory 実装で並置し、テストは Memory 実装で書く。主要サービスは channels（購読箱 + nested connector CRUD + schedule entries + adapter dispatch）、claude（起動）、mcp（`.mcp.json` install と stdio サーバ）、profiles、settings、local-config（funnel.json の read / sync / dotenv reader）、token-prompter（TTY での secret 入力）。

### lib/connectors

Slack / GitHub / Discord / Schedule の Connector 実装。型ごとに Listener（必須）と Adapter（callable な場合のみ）と Schema を per-file で並置し、`FunnelConnectorFactory` の `switch` で discriminated union を dispatch する。schedule のみ adapter なし。Slack / Schedule listener は `slackListenerOptions` / `scheduleListenerOptions` で host integration hook（Bolt `app.action` 追加、event preprocess、one-shot 削除等）を受ける。

### lib/gateway

`Bun.serve` で WebSocket と内部管理 API を同一ポートにホストする daemon。listener supervisor、broadcaster、event log、フラットなルート群を抱える。CLI から listener 操作のために `http://localhost:9742` を叩くのは gateway 経由のみ。

### lib/cli

CLI 入口。argv を内部 HTTP リクエストに変換して Hono アプリへ流す（実ネットワークは経由しない）。`claude` サブコマンドだけは `dispatchClaude` で HTTP routing を bypass し、argv を verbatim に claude へ転送する（positional / 未知の短縮フラグの取り扱いを保つため）。

### lib/tui

OpenTUI ダッシュボード。`fnl`（引数なし）で起動する葉。CLI レイヤ依存なし。

### lib/funnel.ts と lib/bin.ts と lib/index.ts

`funnel.ts` が全 Service を束ねる Facade。`bin.ts` が `package.json` の `bin` エントリ。`index.ts` が公開 API の re-export。

### lib/logger

汎用 LeucoLogger 系。gateway の `SqliteFunnelEventLog` が SQLite sink として利用。

## Storage 規約

ファイル一覧そのものは README.md の File layout を参照。ここには Claude が新規に永続データを足すときの判断ルールだけを置く。

- 永続データは `~/.funnel/` 配下、揮発ログ / イベントストアは `/tmp/funnel/` 配下に置く
- パスはハードコードせず、各モジュールが `FUNNEL_DIR`（または DI された `dir` / `tmpDir`）から `join` で構築する。Memory 実装でテストできるようにするため
- Connector の per-instance な永続 state は `channels/<channel-id>/connectors/<connector-id>/` 配下に置く。id ベースで切るので rename しても追従する。name ベースで切らない
- Connector の「設定」は settings.json に nested で入れる、「state」だけ上のディレクトリに分ける。設定と state を同じ場所に混ぜない。この分離は Connector のための規約で、Connector の state（lastFiredAt / poll watermark 等）は量があり頻繁に書き換わるため別ディレクトリに逃がす。一方 Profile の `sessionId` は profile に 1 個ぶら下がるだけの軽量な execution state で、profile（by id）が所有することに意味がある（rename 追従・transport 層からの隠蔽）。これは settings.json の profile に内包してよい（別ファイルに切らない）。「混ぜない」は「人手の config に大量の流動 state を流し込むな」の意であって、profile が自分の session を 1 個持つことは禁じない
- daemon 系の揮発ファイル（pid / token 等）は `~/.funnel/` 直下に置く
- funnel.json はリポジトリ側 commit 物。funnel 本体は絶対に書き換えない（トークンは env / `.env.local` / `~/.funnel` のいずれかで保持し、commit されない）
- Gateway ポートは 9742（`FUNNEL_PORT` で変更可）

## 設計原則

### CLI とルーティング

- 対話禁止。すべてオプション引数で完結する（Claude-first）。例外は `FunnelLocalConfigSync` の最終 fallback プロンプトのみで、それも `process.stdin.isTTY` で gate する
- ルートファイルは `lib/cli/routes/` 直下にフラット配置。ファイル名は URL パスに 1:1 対応（ドット区切り、動的セグメントは `$param`）。1 URL = 1 file = 1 method を保つ
- CLI verb は read 系（list / show / launch）以外すべて POST に写し、verb は URL セグメントとして残す。Hono は URL で disambiguate する
- help は別ファイルにしない。エンドポイント内で `xxxHelp` を `export` して `zValidator` の第 3 引数に渡し、引数省略形 URL の shortcut route から再利用する
- bin.ts のフォールバックは「`args[0] === "mcp"` は MCP server 直起動、`args[0] === "claude"` は `dispatchClaude` 直叩き、それ以外は HTTP route → 404 → `?help=true` 付きで再投 → top-level `HELP`」
- CLI フラグは kebab-case のまま zod でバリデートし、ハンドラ層で camelCase に詰め直す。自動ケース変換は入れない
- `--channel <name>` 等の名前は CLI ハンドラ層で id に解決してから engine に渡す。engine 側は id を受け取る
- claude への argv 転送は `dispatchClaude` の `parse` で funnel 専用フラグ（`--profile` / `-p` / `--channel` / `--help` / `-h`）だけ取り出し、残りは verbatim に append。`queryToCliArgs` は他コマンド経路だけが使う

### ルート規約

- ハンドラに try/catch を書かない。Service は throw、エラー応答は `throw new HTTPException(status, { message })` に統一する。`return c.text("...", 4xx)` 禁止。`lib/cli/routes/index.ts` の onError が捕捉して `error: <message>` で返す
- `c.req.valid("param")` / `c.req.valid("query")` の結果は分割代入せず、`const param = ...` / `const query = ...` として保持する
- Funnel は middleware で context に乗せる。ルートからは `const funnel = c.var.funnel` で取得する
- `export default` 禁止

### モジュールと依存

- ビジネスロジックは engine と connectors のクラスに集約（Hono 非依存）
- クラスは DI（コンストラクタで依存を受け取る）。`Object.freeze(this)` で immutable
- 既存クラスを薄くラップしただけの `createXxxService(store)` 関数は作らない。DI が複数あるときだけ create 関数を置く
- 外部境界は abstract class + Node / Memory 実装を並置。テストは Memory 実装で書く（実 FS / spawn / fetch / WebSocket / TTY に触れない）
- logger だけは例外で **optional・default インスタンスを作らない**。`logger?: FunnelLogger` を DI で受け、内部は `this.logger?.info(...)` の optional chaining で呼ぶ（未注入なら sliently no-op）。これでテストは何も注入せず勝手に静か（実 FS に触れない）になり、`?? new NodeFunnelLogger()` の結線を全クラスから排除できる。本物の file sink は production 入口（`lib/cli/index.ts` / `lib/gateway/daemon.ts`）で `new Funnel({ logger: new NodeFunnelLogger() })` として一度だけ注入する。エラーを host に晒す経路は logger ではなく `OnFunnelError`（DI 維持・テストで assert する seam）— 2 つを混ぜない
- 公開 API は `lib/index.ts` で `export * from`。他モジュールから参照されない module-internal な型は元ファイル側で `export` を外す

### Connectors

- Connector は channel に nested で持つ。CRUD は `FunnelChannels` 経由。トップレベルの集約クラスは持たない（型ごとの分散による型安全 dispatch）
- 各型に Listener と Adapter と Schema と EventProcessor を per-file で並置。Factory の `switch` で discriminated union を分岐し、`as` キャストは使わない
- Channel ↔ Profile の双方向依存は `ProfileChannelChecker` / `ProfileChannelRefUpdater` の型で切り、`FunnelChannels` が DI で受け取る
- 新しい Connector 型を足すときは per-type ファイルと factory の `switch` に追加し、MCP に出すなら `channel-server.ts` の `TOOL_CONNECTOR_TYPES` に追記する
- Slack / Schedule の host integration hook を増やすときは `SlackListenerOptions` / `ScheduleListenerOptions` を拡張し、Factory → Funnel facade まで素通しで通す

### Gateway とライフサイクル

- 同一 `Bun.serve` で WebSocket と内部管理 API（`/health` `/status` `/listeners*` `/channels/.../call`）をホストする
- WebSocket クライアントは `?channel=<name>` で接続し、そのチャネルの connector イベントだけ受信する
- listener は `start(notify)` / `stop()` / `isAlive()` を持ち、`FunnelListenerSupervisor` が registry を所有して 30 秒間隔の health check と exponential backoff（cap 60s）の自動再起動を行う
- 外側からは `Funnel.listeners` が gateway HTTP を叩く。`Funnel.gateway` は daemon プロセス管理だけに専念する
- connector CRUD ルート（add / remove / set / rename）は store 変更後に `Funnel.listeners` を経由して listener を hot-reload する。`FunnelLocalConfigSync` の rename-by-token 経路は engine を直接叩くため reload が走らない（`fnl gateway restart` 必要）
- Broadcaster は WS fanout に加えて in-process subscriber を `subscribe(handler)` で受ける。`getBufferedAmount()` が 1 MiB を超えた slow consumer は 1009 で切り捨てる
- 永続 replay は `FunnelEventLog` 抽象 port（`record` / `loadSince` / `findMaxOffset` / `close`）に閉じる。default 実装は `SqliteFunnelEventLog`（再起動跨ぎの replay と offset 永続を担う）、`MemoryFunnelEventLog` は in-process double。`gatewayServer({ eventLog })` で注入でき、無指定なら dbPath の SQLite。Broadcaster が依存するのは `loadSince` だけ（narrow な `ReplaySource`）なので EventLog は interface segregation で繋がる
- in-process で全 event を観測したい host は `FunnelGatewayServer.onEvent(handler)`（= broadcaster.subscribe の薄い委譲）を使う。別プロセスの daemon は観測できない（WS クライアントを使う）。`onEvent` は書き出し専用で、replay（読み戻し）は EventLog の責務 — 2 つを混ぜない
- daemon 起動コマンドは `bun .../dist/gateway/daemon.js funnel-gateway[<FUNNEL_DIR>]` の形で argv 末尾に dir tag を付ける。Slack Socket Mode 起動時の競合 kill は `ps -o args=` でこの tag を grep して同 dir の daemon だけを kill する（別 `~/.funnel/` を指す他 install には触らない）

### Schedule Connector

- cron 5 フィールド + プロンプトを保存し、毎分 tick で発火する
- `lastFiredAt` から逆走してスリープ復帰や daemon 再起動で落ちた分を catch-up 発火する（上限 24 時間）。catch-up は `meta.catchup = "true"` を付ける
- cron 評価は自前実装（`*` / `N` / `A-B` / `*/N` / `A,B` 対応）
- `scheduleListenerOptions.onFired` で host 側に通知できる（one-shot エントリ削除等）。throw は logger に捕捉され tick を止めない

### MCP Channel

二系統を 1 つの stdio MCP サーバで提供する。受信（events）と送信（tools）は実装も方向も別。

- 受信系 — gateway に WS 接続してイベントを Claude に流す。`FUNNEL_CHANNEL_ID` 未設定なら no-op。`experimental: { "claude/channel": {} }` capability 必須。対象リポジトリの `.mcp.json` は `fnl claude` 起動時に `FunnelMcp.install` が自動追記する（既存エントリは触らない）
- 送信系 — 起動時に該当チャネルの connectors を読み、tool 1 つに 1 connector を動的公開する（schedule は除外）。tool 名 = connector 名、引数は `{ method, path, body? }`。tool 呼び出しは gateway の channel call エンドポイントへ Bearer auth 付き HTTP POST し、レスポンス JSON をそのまま Claude に返す（bash を経由しない）

### TUI と Claude 起動

- `fnl`（引数なし）で OpenTUI ダッシュボード。キーは `r` リフレッシュ、`q` / `esc` / `Ctrl-C` 終了
- `fnl claude` の解決順（`dispatchClaude`）:
  1. `--help` / `-h` → help を stdout
  2. `--profile` と `--channel` の同時指定 → error（profile が既に channel を bind しているため併用不可）
  3. `--profile <name>` / `-p <name>` → 名前付き global profile（funnel.json は無視）
  4. cwd の `funnel.json` がある → `--channel <name>` で channels[] から選択（無指定なら先頭）、sync し、その channel に bound な funnel.json profiles[] 先頭の recipe を適用して launch
  5. funnel.json が無く `--channel <name>` のみ → raw launch（recipe 無し、既存 `~/.funnel/settings.json` のチャネルを使う）
  6. default global profile → launch
  7. どれも当たらない → help を stdout
- recipe（options/env/resume）は解決された profile から `LaunchOptions` 経由で渡す。argv の組立順は `[profile.options] [user CLI args] [MCP server flag]`。env は `profile.env` → `process.env` の順で被せる（process.env が勝つ）。同名フラグは後ろが勝つ
- 同一 profile 名の二重起動は PID ファイルで拒否する
- `fnl schema` で `funnel.json` の JSON Schema を stdout、`make build` で `funnel.schema.json` と `public/schema.json` を再生成

