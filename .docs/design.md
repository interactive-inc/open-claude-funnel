## 設計

## 全体構造

### CLI を Hono にマップ

argv を内部 HTTP リクエストに変換して Hono でルーティングする（ネットワーク通信は発生しない）。ルート定義とバリデーションを将来の HTTP API にそのまま転用するため、かつ CLI・TUI・プログラマブル API で同じ Module 層を共有するため。

ビジネスロジックは `lib/modules/` の外に漏らさない。ルートは validate と Funnel 呼び出しとレスポンス整形だけにする。

### argv キーワード → HTTP メソッド

副作用を表すキーワードを HTTP メソッドに対応させる。path から消すか残すかで「冪等性の低い操作」と「リソース配下の名前付き副作用」を区別する。

add / remove / set は path から消す（HTTP メソッドだけに反映）。rename / attach / detach は path に残す（対象の関係性を URL で表現するため）。新しいキーワードを足すときはこの区分のどちらかを先に決める。思いつきで増やさない。

### API call は method + path + body

Connector の外部 API 呼び出しは `fnl connectors <name> <method> <path> [body]` 形式で受け、`FunnelConnectorAdapter.call({ method, path, body })` に渡す。Slack（apiCall で全て POST）/ GitHub（gh api spawn）/ Discord（REST fetch）は method の扱いがそれぞれ違うが、呼び出し側は同じ DSL を保つ。

### Funnel Facade

全 Module を束ねる `Funnel` クラスを CLI・TUI・プログラマブル呼び出しの単一入口にする。Module の依存関係は Funnel が解決し、ルート層で個別 Module を new しない。

Service は毎回の getter 呼び出しで new するが、`store` を共有するので状態は同じ（memoize しない方が immutable で扱いやすい）。

### DI は abstract class で揃える

外部副作用を持つ境界（ファイルシステム、設定ストア、Connector Adapter など）は abstract class で抽象化し、本番実装（`NodeFunnelFileSystem` / `FunnelSettingsStore` / `FunnelSlackAdapter` 等）と、テスト時の in-memory 実装（`MemoryFunnelFileSystem` / `MockFunnelSettingsReader` 等）を切り替える。これでテストから実 FS や実 API を触らずに済む。

### ログとエラーの出口

モジュールは logger を使い、CLI 境界のみ `process.stdout.write` / `process.stderr.write` を使う。標準出力を汚すと呼び出し側の処理が壊れるため。

エラーは Module で throw し onError で整形する。経路を増やさないことで CLI 出力を一貫させる。エラーメッセージとコード内の文字列は英語で統一（ドキュメントだけ日本語）。

### CLI 規約

対話 UI は入れない（Claude-first）。短縮形は `-h` / `-v` / `-n` のみに限定する（衝突回避）。全ルートが `?help=true` でヘルプを返す。`--help` / `-h` は argv → query 変換で `?help=true` になる。

help 要求で該当 route が無い場合、まず同 URL を GET で再試行し、それでも無ければ親グループの help にフォールバックする（ユーザーが具体コマンドの help を叩いたときに最低でもグループ全体の help を返せるようにする）。

## データモデル

### 参照は名前文字列

実体はトップレベル配列に一元管理し、他から参照するときは名前のみ保持する。rename は参照側の文字列を差し替えるだけで整合が取れる。

### Agent の channel は単一

Agent は Channel をひとつだけ持つ。複数 Channel を受けたいなら Channel 側の connectors を増やす。Agent 起動時の MCP 接続を1本に保つため。

### 削除時のポリシー差

Channel と Repository は Agent から参照されていれば削除拒否、Connector は Channel から黙って除去する。Agent（起動プリセット）は壊さない／Channel の購読内訳は壊れてよい、という意図。

### スキーマは寛容に読んで厳格に検証する

欠損フィールドは Zod の default で補完する。不正な値は明示的に throw する。補完は読みやすさのため、無視はデータ欠損を隠すので禁止。

Connector は discriminated union。type ごとに必須フィールドが異なり、Zod が自動で narrow する。Slack は bot/app token、gh は pollInterval（optional）、discord は bot token。

### 永続と揮発の分離

設定は `~/.funnel/`（永続、持ち運び対象）、ログとイベントは `/tmp/funnel/`（揮発）。イベントログは日次ローテーションし、30 日より古いファイルは起動時に自動削除する。

## Gateway

### 集約デーモンにする理由

Slack Socket Mode は1トークン1接続が自然。Claude Code ごとに個別接続させると重複イベント・rate limit・トークン再配布の問題が出る。gateway を1プロセスに集約し、Claude Code 側は MCP 経由で購読バスに繋ぐだけにする。

### 起動は暗黙でいい

`fnl claude` 実行時に gateway が停止していれば自動起動する。ユーザーが `fnl gateway start` を覚えなくてもチャネル機能が動くように。macOS では `caffeinate -i` で wrap し、スリープで Socket Mode が切れないようにする（`--no-caffeine` で opt-out 可）。

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

`notifications/claude/channel` capability は Claude Code の実験的仕様。`lib/modules/mcp/channel-server.ts` に閉じ込めて他レイヤーに漏らさない。

### 再接続は静かに

gateway 切断を MCP クライアント側に漏らさない（system イベントとして明示的に送るもの以外）。gateway が落ちても Claude 自体は動き続ける前提を守る。
