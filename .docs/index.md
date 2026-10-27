# Funnel

- 外部接続を共有し、チャネル購読者へイベントを配信するライブラリ。
- 接続プロトコルと再接続は Flume、配信と再送は Funnel、起動・認証情報・保存先はホストが所有する。
- [設計](design.md) / [0.72 移行](migration-0.72.md)。
- 過去の構想は [0.71 以前](history/overview-before-0.72.md)、[TUI](history/tui-design.md)、[旧 doctor の検討](history/claude-doctor-npm-global-warning.md)。いずれも現行仕様ではない。
- [再送先と停止意図の決定](decisions/2026-09-07-replay-and-listener-lifecycle.md) の配信不変条件は維持する。記載された旧 CLI と暗黙の保存先は廃止。
