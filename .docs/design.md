## 設計

## 全体構造

### CLI を Hono にマップ

argv を内部 HTTP リクエストに変換して Hono でルーティングする（ネットワーク通信は発生しない）。ルート定義とバリデーションを将来の HTTP API にそのまま転用するため、かつ CLI・TUI・プログラマブル API で同じコア層を共有するため。

ビジネスロジックは `lib/engine/` と `lib/connectors/` の外（gateway / cli / tui）に漏らさない。ルートは validate と Funnel 呼び出しとレスポンス整形だけにする。

### argv verb → URL セグメント

read 系（list / show / launch）以外の CLI verb はすべて POST に写し、verb は URL セグメントとして残す。Hono は URL で disambiguate する（`/channels/add/:channel` と `/channels/remove/:channel` のように）。method を剥がさず URL に verb を残すことで、1 URL = 1 file = 1 method を保ち、ルートファイルがパスに 1:1 対応する。新しい verb を足すときもこの規約に乗せる。思いつきで増やさない。

### API call は method + path + body

Connector は Channel に nest されるので、外部 API 呼び出しは `fnl channels <channel> connectors <connector> request <method> <path> [body]` 形式で受け、Adapter の `call({ method, path, body })` に渡す。Slack（apiCall で全て POST）/ GitHub（gh api spawn）/ Discord（REST fetch）は method の扱いがそれぞれ違うが、呼び出し側は同じ DSL を保つ。MCP 経由（Claude → 外部）も同じ call エンドポイントを HTTP hop で叩く。

### Funnel Facade

全 Service を束ねる `Funnel` クラスを CLI・TUI・プログラマブル呼び出しの単一入口にする。Service の依存関係は Funnel が解決し、ルート層で個別 Service を new しない。

Service は getter で公開し、初回アクセス時に new して `memos` に保持する（同一インスタンスを返す）。境界（fs / process / clock / id / store）も同じく memoize するので、Funnel 1 つの中では全 Service が同じ境界実装を共有する。

### DI は abstract class で揃える

外部副作用を持つ境界（ファイルシステム、設定ストア、Connector Adapter など）は abstract class で抽象化し、本番実装（`NodeFunnelFileSystem` / `FunnelSettingsStore` / `FunnelSlackAdapter` 等）と、テスト時の in-memory 実装（`MemoryFunnelFileSystem` / `MockFunnelSettingsReader` 等）を切り替える。これでテストから実 FS や実 API を触らずに済む。

### ログとエラーの出口

モジュールは optional な logger を DI で受け（`this.logger?.x` で呼ぶ。未注入なら静かに no-op し、本番入口でだけ file sink を 1 度注入する）、CLI 境界のみ `process.stdout.write` / `process.stderr.write` を使う。標準出力を汚すと呼び出し側の処理が壊れるため。host にエラーを晒す経路は logger ではなく `OnFunnelError`（DI seam）に分ける。

エラーは Service で throw し、ルートの onError（CLI）で整形する。経路を増やさないことで CLI 出力を一貫させる。エラーメッセージとコード内の文字列は英語で統一（ドキュメントだけ日本語）。

### CLI 規約

対話 UI は入れない（Claude-first）。短縮形は `-h`（help）/ `-n`（name）/ `-p`（profile）のみに限定する（衝突回避）。全ルートが `?help=true` でヘルプを返す。`--help` / `-h` は argv → query 変換で `?help=true` になる。

help 要求で該当 route が無い場合、まず同 URL を GET で再試行し、それでも無ければ親グループの help にフォールバックする（ユーザーが具体コマンドの help を叩いたときに最低でもグループ全体の help を返せるようにする）。

## データモデル

### 参照は id、表示は name

実体は不変の id（UUID）を主キーに持つ。他から参照するときは id を保持する（Profile は `channelId` で Channel を指す）。id ベースで切るので rename は name を差し替えるだけで済み、参照側も per-instance state（Connector の state / Profile の session）も追従する。name は CLI/TUI が指すラベルにすぎず、storage のキーには使わない。CLI ハンドラ層で name を id に解決してから engine に渡す（engine は id を受け取る）。

### Profile の channel は単一

Profile は Channel をひとつだけ持つ。複数 Channel を受けたいなら Channel 側の connectors を増やす。Profile 起動時の MCP 接続を1本に保つため。

### 削除時のポリシー差

Channel は Profile から参照されていれば削除拒否（`ProfileChannelChecker.hasChannelRef(channelId)` で問い合わせる）、Connector は Channel から黙って除去する。Profile（起動プリセット）は壊さない／Channel の購読内訳は壊れてよい、という意図。Profile → Channel の一方向依存で、Channel（transport コア）は Profile（launch おまけ）を知らない。

### Profile の session は profile が持つ

Claude session の resume 用 id は Profile の execution state として profile（by id）に内包する。channel や cwd でキーしない。同じ repo で起動した無関係な session を引き継がず、profile-less な起動（`--channel` 直）は resume しない。transport 層（Channel）は session を一切知らない。

### スキーマは寛容に読んで厳格に検証する

欠損フィールドは Zod の default で補完する。不正な値は明示的に throw する。補完は読みやすさのため、無視はデータ欠損を隠すので禁止。

Connector は discriminated union。type ごとに必須フィールドが異なり、Zod が自動で narrow する。Slack は bot/app token、gh は pollInterval（optional）、discord は bot token。

### 永続と揮発の分離

設定は `~/.funnel/`（永続、持ち運び対象）、診断ログとイベントストアは `/tmp/funnel/`（揮発）。イベントの永続 replay は `FunnelEventLog` 抽象 port に閉じる（default は `SqliteFunnelEventLog`、テスト / 軽量 embedder 向けに `MemoryFunnelEventLog`）。Broadcaster は WS fanout に加えてこの log に offset を打ち、再起動跨ぎの replay を支える。

## Gateway

### 集約デーモンにする理由

Slack Socket Mode は1トークン1接続が自然。Claude Code ごとに個別接続させると重複イベント・rate limit・トークン再配布の問題が出る。gateway を1プロセスに集約し、Claude Code 側は MCP 経由で購読バスに繋ぐだけにする。

### 起動は暗黙でいい

`fnl claude` 実行時に gateway が停止していれば自動起動する。ユーザーが `fnl gateway start` を覚えなくてもチャネル機能が動くように。macOS では `caffeinate -is` で wrap し、アイドル / システムスリープで Socket Mode が切れないようにする（`--no-caffeine` で opt-out 可）。

### Channel 単位で配信を絞る

gateway は全 Connector のイベントを受けるが、クライアントには Channel が購読する Connector のイベントだけを送る。クライアント側フィルタにすると無駄なトラフィックが流れ、Settings の二重管理になる。

### Channel 名は認証にならない

Channel 名は可読文字列なので秘匿情報ではない。gateway は localhost バインドのみを想定する。外部公開しない前提を崩さない。

### イベントを絞るときの注意

Slack listener で落としたイベントはイベントログにも残らない。絞り込みを足すときはデバッグの手掛かりが消える点を意識する。

### Connector 種別ごとの listener

Slack は Bolt Socket Mode、GitHub は `gh api /notifications` polling、Discord は discord.js の Gateway。gh listener は `since` パラメータで API 側フィルタし、`(id, updated_at)` の組でローカル重複排除する（同一 thread の新コメントも拾えるよう id 単独では比較しない）。

## MCP Channel

### stdio と WebSocket の二段構え

Claude Code とは MCP（stdio）、外部イベント受信は gateway への WebSocket。Claude から直接外部サービスを触らせない、gateway から直接 Claude に書かない。

### 接続ゲートは FUNNEL_CHANNEL_ID

未設定なら WebSocket には繋がず stdio の MCP サーバとしてだけ起動する。funnel 経由でない素の Claude Code 起動で副作用が出ないことを担保し、`.mcp.json` の自動書き込みを安全にする。

### MCP server 名は動的解決

`.mcp.json` は `claude mcp add` でユーザーが任意の key 名で追加することもある。`FunnelMcp.findInstalledName(cwd)` で `command: "funnel"` な entry を検索して、その key を `--dangerously-load-development-channels server:<key>` に渡す。funnel 側がハードコードした名前に依存しない。

### experimental 依存を局所化

`experimental: { "claude/channel": {} }` capability は Claude Code の実験的仕様。`lib/engine/mcp/channel-server.ts` に閉じ込めて他レイヤーに漏らさない。

### 再接続は静かに

gateway 切断を MCP クライアント側に漏らさない（system イベントとして明示的に送るもの以外）。gateway が落ちても Claude 自体は動き続ける前提を守る。
