## 構想

funnel は複数の Claude Code エージェントと外部サービスを統合管理するハブ。CLI は Claude 自身が叩ける前提で対話を禁止する。単一ユーザー前提でマルチテナント設計はしない。

## 三層分離

Connector / Channel / Profile を別概念に保つ。

Connector は「外部接続の実体」。送受信プロトコルが異なる実装（Slack Socket Mode、GitHub の通知 polling、Discord Gateway、Schedule の cron tick 等）を discriminated union の type 違いとしてまとめる。Slack のように1トークン1接続が前提の場合もあるため、実体は複製しない。

Channel は「どの Connector を購読するかの束」。複数の購読者（複数 Profile や観察用 TUI）が同じイベント流を共有できるよう、Connector と購読者の間に購読箱を挟む。Channel は複数 Connector を nest して持ち、配信モードは fanout（全員受信）か exclusive（round-robin で1人）。Channel は transport だけを持ち、launch 設定（options / env / resume / session）は持たない。

Profile は「Channel + 起動ディレクトリ（path）+ サブエージェント等の options + env + resume の起動プリセット」。transport model の外側にある launch 便宜レイヤで、起動に必須ではない（`fnl claude --channel <name>` だけで起動できる）。同じ購読内容で起動条件だけ違う Profile を並べるために Channel から独立させる。Profile は Channel を 1 つだけ持つ（MCP 接続を 1 本に保つため）。

Profile に直接 Connector を持たせない、Channel に bot token を持たせない。

## 識別は id、表示は name

Channel / Connector / Profile はいずれも不変の id（UUID）を主キーに持ち、相互参照は id で切る（Profile は `channelId` で Channel を指す）。name は CLI/TUI が人間向けに指すラベルで rename 可能。id ベースで参照するので rename しても追従し、per-instance な永続 state（Connector の state、Profile の session）も name でなく id でキーされて孤児にならない。
