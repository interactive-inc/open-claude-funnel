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

## 購読・返信・終了

- 購読は `events()` を呼んだ時点で開始する。接続の `start()` より先に購読すると、起動時のイベントもキューに残せる。
- `fanout` は全配送先、`exclusive` は WebSocket と同一プロセスの購読を合わせた候補の一つへ送る。両方式を同時接続した場合もこの規則を適用する。`exclusive` のイベント列には再接続でも変わらない `subscriberId` が必要。
- `since` は最後に処理できた offset。指定位置の次から保持中のイベントを再送してライブ配送へ移る。offset はキュー投入や MCP の送信だけで処理完了とみなさず、利用側で必要な基準を決めて保存する。
- 未読キューは `maxQueuedEvents`（既定200件）と `maxQueuedBytes`（既定4 MiB、JSON全体のUTF-8バイト数）で制限する。超過すると当該購読を解除し、`next()` がエラーになる。他の購読は継続する。
- `return()`、`break`、購読の `signal` の abort、gateway の停止で未読入力を破棄し、待機中の `next()` を終了する。使用しなくなった列は、読み始めていなくても解除する。`agentSdkInput` の `return()` も元の列へ解除を伝える。
- gateway の停止は SDK の実行中タスクやホストの MCP サーバーを閉じない。それぞれの既存 API で終了する。
- 返信は利用側が登録した SDK / MCP ツールから `funnel.channels.call(channel, connector, request)` を呼ぶ。受信時のサービス固有メタデータを使って返信先を指定する。投稿可否・送信者の許可・対象ツールの公開はホストで決める。

入力列の形式は [Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、通知と capability は [Channels reference](https://code.claude.com/docs/en/channels-reference) に準拠する。ローカル検証では Agent SDK 0.3.299 の `SDKUserMessage` / `query` / `Query.streamInput` に型が適合し、MCP SDK 1.30.0 の実 Server/Client 間で通知を送受信できることを確認した。Claude への実問い合わせと実際の Claude Code Channels セッションは未検証。
