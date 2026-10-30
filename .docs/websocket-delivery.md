# WebSocket配送の確認と復旧

イベントの発火やbroadcastの成功は、モデルがその入力を受け取って処理した証拠ではない。gatewayは配信前に保存先へ記録し、接続ごとの送信を行う。ホストは保存先の永続性と、受信側の受付・処理状態を別々に確認する。

## 送信結果

BunのServerWebSocket.sendは、非空のpayloadに対して0なら破棄、-1ならbackpressure下で受付済み、正の値なら送信したバイト数を返す。空フレームの0は成功なので区別する。公式仕様は [Bun WebSockets](https://bun.com/docs/runtime/http/websockets#backpressure) を参照する。

Funnelは非空payloadの0と送信例外を失敗として扱う。その接続を配信先から外して1011で閉じ、onErrorのcomponent=broadcaster.sendへoffset・channel・connectorを渡す。ほかの正常な配信先への送信と、保存済みイベントの再送可能性は保つ。-1を失敗扱いにして同じイベントを即再送しない。

## 再送

WS接続時の再送は、履歴の読み取りと送信の両方を確認する。どちらかが失敗したら接続を閉じ、component=gateway-server.replayでホストへ返す。失敗した接続をlive配信先として登録せず、開いたまま取り残さない。close自体も失敗した場合は、元の失敗とclose失敗をAggregateErrorに残す。

購読者は安定したsubscriber idを使い、受理した最後のoffsetをsinceにして再接続する。失敗したイベントをbroadcastし直す必要はない。Funnelの再送は保持中の履歴を使うため、プロセスを越える復旧にはホストが永続保存先を注入する。

## 確認できる範囲

接続数が正でも、モデルへの入力到着は保証しない。WSの送信受付、MCP通知の書き込み、SDK入力列への受理、モデルの応答は別の境界である。診断ではイベントのoffsetと接続・再接続の記録を照合し、モデル処理の完了を送信成功から推測しない。

## 回帰検証

broadcasterのMemory検証では、送信破棄時の閉鎖・正常な配信先の継続・再送履歴の保持と、backpressure受付時の非再送を確認する。gateway-moduleの実Bun WebSocket検証では、再送の0・送信例外・履歴読み取り例外を注入し、閉鎖後の再接続で同じ保存イベントを回収する。実Slackやモデル推論を呼ばない。
