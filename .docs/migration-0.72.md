# 0.71 から 0.72 への移行

0.72 は接続ライブラリへの破壊的変更。0.71 系を使っているアプリは、そのまま依存を更新せず下記を移行する。

| 旧機能 | 0.72 |
| --- | --- |
| `funnel` / `fnl`、CLI routes / bin | 削除。ホストのコマンド・API から library を呼ぶ |
| `funnel.claude`、profiles、session、process guard、daemon 管理 | 削除。エージェント・プロセスの起動はホストが行う |
| `funnel.json`、`~/.funnel`、`FUNNEL_DIR`、tmp / logs / token files | 削除。`channels` またはホスト所有の `store` を渡す |
| `dir` / `tmpDir` / `fs` / `process` / `idGenerator` 引数 | 削除。保存先やシェル実行を接続 API に渡さない |
| `FunnelTransport` / `/transport` | 削除。通常の `Funnel` 自体が接続のみを担当 |
| `Funnel.inMemory()` | `new Funnel()`。既定でメモリ内 |
| gateway の暗黙のポート・token | `port` と `token` を明示。`port: 0` は自動割当。`token: ""` はホスト自身で認証する場合だけ |
| `dbPath`、暗黙の SQLite | `eventLog` を渡す。必要なら `/sqlite` から `SqliteFunnelEventLog({ path })` を作る |
| `/event-log` や `/gateway` から SQLite を import | `/sqlite` へ変更。通常の import はディスク IO を含まない |
| `gh auth token` / `gh api` | 接続の `token` または `tokenEnv` と REST。端末の CLI ログインには依存しない |
| schedule の保存ファイル | `scheduleConnector({ stateStore })`。既定はメモリ |
| time channel の `persist` と channel directory | `timeChannel({ statePersister })`。指定しなければ保存・catch-up は無効 |
| `/status` / `/health` の pid / funnelDir | 削除。プロセス・作業場所の識別はホストで行う |
| `/debug` の単一 listener・診断・CLI 案内 | `listeners` 全件、`subscribers`、取得した履歴。解釈と次の操作はホストが判断 |
| 保存失敗を記録するだけの `SqliteFunnelEventLog.record()` | logger / onError への通知後に例外を返す。保存失敗後のライブ配送を防ぐ |
| `FunnelListenerRegistry.keyOf(channelName, connectorName)` | `keyOf(channelId, connectorId)`。安定 ID の組を衝突なく保持する。start / stop / restart の操作引数は引き続き現在の名前 |

独自イベントログの `loadSince(since, limit?)` は offset 昇順で返し、任意の `limit` が指定された場合は件数を制限する。引数省略時の全件取得は維持する。配信イベントとメタデータは読み取り専用の snapshot になり、加工は利用側のコピーに対して行う。

再起動後も再送するホストは、イベントログだけでなく設定ストアのチャネル ID とコネクタ ID も維持する。ホスト所有のログはホストが閉じる。

改名は ID を維持し、削除後の別の接続には新しい ID を発行する。明示停止や認証失敗による自動復旧の抑止は改名でも維持する。認証情報などを直した後は、現在の名前で明示的に start / restart する。

既定のメモリ再送保持は直近200件・4 MiB。容量超過分は全文のイベント単位で古いものから破棄し、本文の途中を切り詰めない。長期の再送や再起動をまたぐ再送は明示した永続ログで行う。

Agent SDK / Claude Code Channels への接続は [組み込み契約](embedding.md) を参照する。`/claude` の入力列・通知値を利用側の API に渡し、SDK や MCP Server の起動・終了・設定は利用側で扱う。

Inta の既存 0.71.4 利用は、このソース変更だけでは更新されない。Inta 側の daemon・設定保存・資格情報連携を上記に合わせて移行してから、新版を取り込む。
