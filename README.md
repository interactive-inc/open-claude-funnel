# Open Claude Funnel

外部イベントを Claude Agent SDK や Claude Code Channels に組み込むための接続・配信ライブラリです。受信プロトコルと再接続は [Flume](https://github.com/interactive-inc/open-flume) が担当し、Funnel は配信、再送、外部への返信を扱います。

CLI、エージェントの起動、作業ディレクトリ、設定ファイル、資格情報の保存は持ちません。設定と再送ログは既定でメモリ内に保持します。

## 接続する

```ts
import { Funnel } from "@interactive-inc/claude-funnel"
import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"

const funnel = new Funnel({
  connectors: [slackConnector()],
  channels: [{
    name: "ops",
    connectors: [{
      type: "slack",
      name: "team",
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
    }],
  }],
})

// Bun を利用する場合。ポートと認証はホストが指定する。
const gateway = funnel.gatewayServer({
  port: 9742,
  token: process.env.AGENT_CONNECTION_TOKEN!,
})
await gateway.start()

// 同一プロセスから配信を観測する。購読の解除関数を返す。
const unsubscribe = gateway.onEvent((event) => console.log(event.content))

// 終了時
unsubscribe()
await gateway.stop()
```

別プロセスの購読者は `/ws?channel=ops&id=worker-1` に接続します。認証には `/gateway` の `channelWsProtocols(token)` を WebSocket の subprotocol として渡します。`since=<offset>` を付けると保持中のイベントを再送します。

`channel` の欠落や不正な `since` は HTTP 400 で拒否します。再送の読み取り・送信に失敗した接続は code 1011 で閉じるため、最後に処理できた offset から再接続してください。

ホスト自身が Bun の HTTP/WebSocket サーバーを持つ場合は、`gatewayModule({ token })` の `app`、`handleUpgrade`、`websocket` を組み込みます。Node.js では同一プロセスの配信 API と Hono の `app` を利用できます。`gatewayServer()` と WebSocket upgrade helper は Bun 専用です。

## Agent SDK / Channels に組み込む

SDK の `query()` と MCP の `Server` は利用側のものをそのまま使います。Funnel はそのインスタンスを受け取らず、入力と通知の値を返します。SDK・MCP を依存として追加することもありません。

Agent SDK の `prompt` にイベント列を渡す例です。上の `funnel` を使い、HTTP を待ち受けない構成にします。

```ts
import { query } from "@anthropic-ai/claude-agent-sdk"
import { agentSdkInput } from "@interactive-inc/claude-funnel/claude"

const gateway = funnel.gatewayModule({ token: "" })
const events = gateway.events({ channel: "ops", subscriberId: "assistant" })
const input = agentSdkInput(events)
try {
  await gateway.start()
  for await (const message of query({ prompt: input })) {
    // SDK の応答をそのまま扱う。権限・セッション・ツールも SDK の API で設定する。
    if (message.type === "result") console.log(message)
  }
} finally {
  await input.return?.()
  await gateway.stop()
}
```

Claude Code Channels では、ホストの MCP `Server` に `claudeChannelCapabilities` を合成し、同じ `events` から取り出した値を `mcp.notification(claudeChannelNotification(event))` に渡します。既存のツール・transport・接続処理をそのまま使えます。

[両方式の組み込み例と終了・返信の契約](.docs/embedding.md)を参照してください。`events()` はチャネル単位の配送先です。`onEvent()` は全イベントの監視用で、配送先の選択とは独立しています。

## 返信する

```ts
await funnel.channels.call("ops", "team", {
  method: "POST",
  path: "chat.postMessage",
  body: { channel: "C_EXAMPLE", text: "完了しました" },
})
```

Slack、Discord、GitHub の接続は `/connectors/<type>` から必要なものだけ import します。GitHub は受信・送信とも渡された token を使用し、`gh` コマンドや端末のログイン状態に依存しません。

## 配信と状態の所有

- `fanout` はチャネルの全購読者へ配信します。`exclusive` は交換可能なワーカーの一つへ配信し、再送先を維持します。
- 現在の接続状態は Flume の snapshot を参照します。接続中の `connected` と、再接続処理が生きている `alive` を区別します。
- 既定の再送保持は直近200件・4 MiBまでです。全文を配信し、容量超過時は古い保持イベントを削除します。プロセスを終了すると履歴は失われます。
- 再起動をまたぐ保持が必要な場合は、`gatewayModule` / `gatewayServer` にホスト所有の `eventLog` を渡します。注入したログはホストが閉じます。
- 設定の保存は任意の `store` を渡して行います。保存・再読込する場合はチャネルとコネクタの ID を維持してください。Funnel はパスやファイル形式を定めません。
- チャネルの ID と名前は設定全体、コネクタの ID と名前は所属チャネル内で一意にしてください。ID は空文字列にできません。不正な保存設定は読み取り時に拒否します。
- 既定のメモリ store は、通常のオブジェクトと配列で構成された設定データを読み書き時にコピーします。取得結果を加工しても保存内容は変わりません。変更にはチャネル API または同期的な `store.update` / `store.write` を使います。独自設定内の関数・クラスインスタンスなどのリソースはホスト所有の参照を維持します。
- 定期実行の発火状態も既定はメモリです。`scheduleConnector({ stateStore })`、または `/channel` の `timeChannel({ statePersister })` にホストの保存処理を渡せます。
- `Funnel({ signal })` のキャンセルは接続の監視・復旧も停止します。Bun helper が所有する待受も閉じます。ホスト所有の待受はホストが閉じます。
- 接続の所有権・起動ロック・停止意図はチャネル ID とコネクタ ID で保持します。改名だけでは接続を開き直さず、配送時に現在の名前を使います。同じ名前で新しい ID の接続を作っても、以前の接続からは配信しません。
- 認証情報など接続内容を変えた場合、ホストが `gateway.getRegistry().restart(channel, connector)` で対象を更新します。設定から削除した接続は次の監視処理で停止します。直ちに停止したい場合は削除前に `stop(channel, connector)` を呼びます。
- 起動のタイムアウトと自動復旧の待ち時間は完了・停止時にキャンセルします。停止後の待ち時間だけで Node.js プロセスを保持しません。
- `events({ channel, subscriberId, since, signal })` は同一プロセスの購読を作ります。WebSocket と同じ fanout / exclusive・宛先指定・再送を使います。購読は呼び出した時点で始まり、`return()`・ループの `break`・abort・gateway 停止で解除します。
- 未読キューは既定で200件・4 MiBまでです。超過は購読のエラーとして返し、停止時は未読入力を破棄します。最後に処理できた offset から、保持範囲内で再購読できます。
- 保存済み履歴の再送は読み取りに合わせて進みます。履歴全件を未読キューに詰めないため、長い履歴も小さなキューで処理できます。再送中に届く新着イベントには未読キューの上限が適用されます。
- 配信イベントとメタデータは読み取り専用の snapshot です。本文や宛先の変更は自分のコピーで行い、別の購読者や保持履歴に影響しません。
- 公開入力のチャネル・接続の識別情報は gateway が付けます。`meta` に `connector` や `connectorId` を入れても接続の指定には使われません。接続由来の入力として公開する場合は `connector` 引数を使ってください。

明示停止した接続を監視が再開することはありません。再送が同じワーカーへ届いても、外部副作用の実行が一度だけになる保証とは別です。

## 任意の保存アダプター

```ts
import { SqliteFunnelEventLog } from "@interactive-inc/claude-funnel/sqlite"

const eventLog = new SqliteFunnelEventLog({ path: hostChosenDatabasePath })
const gateway = funnel.gatewayModule({ token, eventLog })
```

SQLite アダプターは Bun 専用です。通常の import では SQLite やファイルシステムを読み込みません。

## 開発と移行

```sh
bun install
bun run typecheck
bun test
bun run build
bun run check:package
node scripts/check-node-composition.mjs
```

CI は Linux と Windows で型検査、通信・再接続・SQLite を含むテスト、ビルド、配布検査、Node.js の組み込み検査を行います。`gatewayServer()` と SQLite はどちらの OS でも Bun が必要です。

Node.js 22 以降または Bun 1.3 以降。設定、接続、配信の API は TypeScript の公開型を参照してください。0.71 系からの破壊的変更は [移行案内](.docs/migration-0.72.md)、設計は [設計メモ](.docs/design.md) にあります。

MIT © Interactive Inc.
