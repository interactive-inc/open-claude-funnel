# Agent SDK / Claude Code Channels に組み込む

Funnel は外部イベントの配送部品。利用側が Agent SDK の `query()` や MCP の `Server` を作成し、Funnel の入力・通知を組み合わせる。SDK と MCP のインスタンスを包むクラス、セッション起動管理、MCP transport、設定ファイルは提供しない。

`/claude` はデータ変換だけを公開する。SDK と MCP の import は利用側にあり、Funnel の依存には入らない。`gateway.events()` は Node.js でも使え、待受ポートを必要としない。

## Agent SDK

`agentSdkInput(events)` の戻り値を、利用側の `query({ prompt })` または既存 `Query.streamInput()` に渡す。[README の例](../README.md#agent-sdk--channels-に組み込む)を参照する。入力列を利用側で合成したいときは、イベント一つを変換する `agentSdkMessage(event)` も使える。

入力は SDK の user message 形式。本文は `{ content, meta, offset }` の JSON で、外部イベントの本文・チャネル・返信に必要なメタデータ・再送位置を保持する。`session_id` は空文字で、セッションの生成・再開は利用側の SDK 設定に委ねる。本文の加工や画像・ツール入力の合成が必要なら、自分の入力列で SDK のメッセージを作ってよい。

`agentSdkInput` は入力列だけを変換する。SDK の応答、ツール登録、権限判断、中断・終了 API はそのまま利用する。SDK の出力と入力イベントは必ずしも一対一ではないため、最終応答を自動的に最後のイベントへ返信しない。

## Claude Code Channels

以下では、[README](../README.md#接続する) の `funnel` と、ホストが選んだ MCP `transport` を使う。`Server` に既存ツールがある場合は、その capabilities・instructions・handlers に合成する。

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  claudeChannelCapabilities,
  claudeChannelNotification,
} from "@interactive-inc/claude-funnel/claude"

const mcp = new Server(
  { name: "my-channel", version: "1.0.0" },
  {
    capabilities: {
      experimental: {
        ...claudeChannelCapabilities.experimental,
        // ホストの既存 experimental capabilities をここへ合成する。
      },
      tools: {},
    },
    instructions: "外部メッセージは channel・connector・thread_ts などの属性を持ちます。返信にはホストの返信ツールを使ってください。",
  },
)

// ホストが所有する返信ツール等を通常の MCP API で登録する。
// transport の選択・接続もホストが行う。
await mcp.connect(transport)
const gateway = funnel.gatewayModule({ token: "" })
const events = gateway.events({ channel: "ops", subscriberId: "claude-terminal" })
try {
  await gateway.start()
  for await (const event of events) {
    await mcp.notification(claudeChannelNotification(event))
  }
} finally {
  await events.return()
  await gateway.stop()
  // ホストが作成した Server はホストが閉じる。
  await mcp.close()
}
```

`claudeChannelNotification` は `notifications/claude/channel` の `{ content, meta }` を返す。本文はそのまま保持し、meta のキーは公式仕様の英数字と `_` だけを通す。再送位置は予約キー `funnel_offset` へ設定する。その他のキーは削除し、元のイベントは変更しない。

Channels は Claude Code 側で有効化したサーバーにだけ届く。MCP の書き込み成功は Claude の処理完了を意味しない。公式プレビューの有効化・制限は [Channels reference](https://code.claude.com/docs/en/channels-reference) を確認する。SDK 経由と Channels 経由は別々の組み込み先であり、SDK 内で Channels を有効化する実装ではない。

## 別プロセスからの操作

`/gateway` の `FunnelGatewayClient` はホストが既に公開した gateway の HTTP プロトコルを扱う。接続先と token の読み取り関数を渡し、`list()` / `start()` / `stop()` / `restart()` で listener を操作し、`publish(channel, input)` でイベントを配送する。daemon の起動・プロセス確認・ファイル・資格情報保存は持たない。

```ts
import { FunnelGatewayClient } from "@interactive-inc/claude-funnel/gateway"
const client = new FunnelGatewayClient({
  baseUrl: "http://127.0.0.1:4442",
  token: () => hostCredentials.currentGatewayToken(),
})
await client.publish("ops", { content: "host event" })
```

認証値はリクエストごとに読み、リダイレクト先へ送らない。ホストが `isAvailable` を注入した場合、その値が false の間は通信せず `state: "offline"` を返す。成功は `state: "ok"`、HTTP・認証値の不足・応答形式・通信の失敗は `state: "error"` と reason で返す。HTTP の送信成功は購読者の処理完了を意味しない。

## 購読・返信・終了

- 購読は `events()` を呼んだ時点で開始する。接続の `start()` より先に購読すると、起動時のイベントもキューに残せる。
- `fanout` は全配送先、`exclusive` は WebSocket と同一プロセスの購読を合わせた候補の一つへ送る。両方式を同時接続した場合もこの規則を適用する。`exclusive` のイベント列には再接続でも変わらない `subscriberId` が必要。
- `since` は最後に処理できた offset。指定位置の次から保持中のイベントを再送してライブ配送へ移る。offset はキュー投入や MCP の送信だけで処理完了とみなさず、利用側で必要な基準を決めて保存する。
- 再送は購読開始時の offset を上限に、`next()` の読み取りに合わせて進める。保存ログは64件以下のページで読み、現在のメモリ保持分と offset 順に合流する。再送中の新着入力はライブ用キューに入り、履歴の後に一度だけ渡す。未読の exclusive 履歴は先に取得者へ割り当てず、読む時点で claim する。
- 未読キューは `maxQueuedEvents`（既定200件）と `maxQueuedBytes`（既定4 MiB、JSON全体のUTF-8バイト数）で制限する。超過すると当該購読を解除し、`next()` がエラーになる。他の購読は継続する。
- `return()`、`break`、購読の `signal` の abort、gateway の停止で未読入力を破棄し、待機中の `next()` を終了する。使用しなくなった列は、読み始めていなくても解除する。`agentSdkInput` の `return()` も元の列へ解除を伝える。
- `agentSdkInput` は解除開始時に待機中の読み取りを終了し、その後の読み取りや遅れて届く元の列のイベントを SDK へ渡さない。元の列に `return()` がなくてもこの規則を適用する。同時に複数回解除しても元の列の解除は一度だけ実行し、その完了または失敗を呼び出し元へ返す。
- gateway の停止は SDK の実行中タスクやホストの MCP サーバーを閉じない。それぞれの既存 API で終了する。
- `gateway.stop()` の開始後は gateway の HTTP 操作と新たな WebSocket 購読を HTTP 503 で拒否する。認証が必要な入口では認証を先に確認する。既存の WebSocket 購読も閉じ、取得済みの registry は接続を再開できなくなる。ホストの独自ルートと `healthRoute: false` でホストが持つ health は継続できる。
- 返信は利用側が登録した SDK / MCP ツールから `funnel.channels.call(channel, connector, request)` を呼ぶ。受信時のサービス固有メタデータを使って返信先を指定する。投稿可否・送信者の許可・対象ツールの公開はホストで決める。

Discord / GitHub の JSON 送信では、本文の省略と空配列・空オブジェクト・`null` を区別する。GET / HEAD は本文を送らず、成功した HEAD と HTTP 204 の戻り値は `null` とする。空の応答を JSON として読み取らない。

独自の `FunnelHttpClient` を注入する場合は `HttpRequest.signal` を通信処理と応答本文の読み取りへ渡す。Slack の起動中の認証は、個別接続の停止・タイムアウトとホスト全体の停止のどちらでも取り消される。注入したクライアントが取消を無視して応答しても、取消後に Flume 接続は開始しない。

独自の `FunnelEventLog` は `loadSince(since, limit?)` を offset 昇順・指定位置の次から返し、`limit` がある場合は読み出し件数を制限する。引数省略時は保持中の全件を返す既存の契約を維持する。ページ順序の違反や読み取り失敗は購読エラーとして返す。`record()` の保存失敗は例外にして配信側へ伝える。SQLite アダプターも logger / onError へ通知した後に例外を返し、保存されていない入力をライブ配送しない。

SQLite の保存失敗では logger と `onError` を独立して呼び、通知先の同期例外や Promise の拒否で、もう片方への通知や元の保存エラーを失わない。通知先が失敗しても、呼び出し元には元の SQLite エラーを返す。

保持件数・期限・バイト上限の行削除が失敗した場合は、同じ transaction の保存と採番を取り消す。commit 後の VACUUM 失敗は `onError` の `op: "compact"`、古い exclusive 割当の掃除の失敗は `op: "prune-claims"` で通知する。保守処理の失敗で保存済みのイベントの配送を止めたり、保存失敗として再試行させたりしない。診断ログの圧縮失敗は、そのログに注入した logger へ通知する。

配信されたイベントの本文・メタデータ・exclusive 割当は読み取り専用で凍結される。値を加工する場合は自分のコピーを作り、Funnel が保持する履歴を変更しない。

公開入力の `channel` / `channelId` / `connector` / `connectorId` は gateway が所有する識別情報で、入力の `meta` からは上書きできない。`connector` 引数を省略した入力は接続の識別情報を持たず、未登録の接続ラベルを渡した場合も `meta` の既存 ID を借りない。登録済みの接続を指定した場合だけ、その接続の ID を付ける。その他のメタデータと入力オブジェクトは維持する。

WebSocket の `/ws` 購読には `channel` が必要。`since` を指定する場合は、非負の安全な整数を十進数の数字列で渡す。空値・負数・小数・末尾の文字・安全な整数の上限超過は HTTP 400 で拒否し、再送を省略した接続として受け付けない。履歴の読み取りまたは再送の送信が失敗した場合は `onError` / logger へ通知し、接続を code 1011・reason `replay failed` で閉じる。利用側は最後に処理できた offset から再接続する。

WebSocket のライブ配信と再送は同じ送信バッファ上限を使い、超過した接続を code 1009・reason `backpressure` で閉じる。Bun の `send()` が返す 0 は送信破棄として扱い、ライブ配信なら code 1011・reason `send failed`、再送なら code 1011・reason `replay failed` で閉じる。再送はページ単位で読み、送信が止まった後の履歴を読み込んだり、未送信分をまとめて exclusive 割当したりしない。

入力列の形式は [Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、通知と capability は [Channels reference](https://code.claude.com/docs/en/channels-reference) に準拠する。ローカル検証では Agent SDK 0.3.299 の `SDKUserMessage` / `query` / `Query.streamInput` に型が適合し、MCP SDK 1.30.0 の実 Server/Client 間で通知を送受信できることを確認した。Claude への実問い合わせと実際の Claude Code Channels セッションは未検証。
