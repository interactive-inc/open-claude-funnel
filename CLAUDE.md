# Open Claude Funnel

接続と配信のライブラリ。利用方法と責任境界は [README.md](README.md)、依存方向と不変条件は [.docs/design.md](.docs/design.md)、0.71 系からの変更は [.docs/migration-0.72.md](.docs/migration-0.72.md) を参照する。

- 作業前に README と対象実装・試験・設定を読む。無関係な変更を混ぜない。
- CLI、エージェント起動、プロファイル、固定ディレクトリ、暗黙の資格情報保存、プロセス探索・停止を本体へ追加しない。
- 外部接続と再接続は Flume が所有する。Funnel で接続フラグを複製しない。復旧中の接続を外側から再起動しない。
- 設定と履歴の既定はメモリ。永続化はホスト注入。通常の import からファイルシステム・SQLite・プロセス実行を読み込まない。
- コネクタはサブエントリから明示的に渡す。core は具体コネクタを import しない。
- SDK / MCP の組み込み境界は [.docs/embedding.md](.docs/embedding.md) を正本とする。利用側の API を使える入力列・通知値を提供する。
- ロジックは engine、配信と HTTP/WebSocket 境界は gateway、組み立ては `lib/funnel.ts`。共通処理を複製しない。
- 失敗は host の onError / logger へ返す。資格情報をログへ出さない。新たな通知先を作らない。
- public API を変えたら README・公開エントリ・ビルド設定・package exports を揃える。旧機能の説明を現行規約に残さない。
- 検証は `make check`、`make build`、`bun run lint`。接続・停止・再接続・再送・認証・保存先の副作用を確認する。
- 作業は main。変更対象だけをコミットし、依頼済みの範囲で push する。npm 公開は別の明示依頼で行う。
