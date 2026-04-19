## 構想

funnel は複数の Claude Code エージェントと外部サービスを統合管理するハブ。CLI は Claude 自身が叩ける前提で対話を禁止する。単一ユーザー前提でマルチテナント設計はしない。

## 三層分離

Connector / Channel / Agent を別概念に保つ。

Connector は「外部接続の実体」。送受信プロトコルが異なる実装（Slack Socket Mode、GitHub の通知 polling、Discord Gateway 等）を discriminated union の type 違いとしてまとめる。Slack のように1トークン1接続が前提の場合もあるため、実体は複製しない。

Channel は「どの Connector を購読するかの束」。複数 Agent が同じイベント流を共有できるよう、Connector と Agent の間に購読箱を挟む。Channel は複数 Connector を購読でき、1 つの Connector を複数 Channel から参照することもできる。

Agent は「Channel + Repository + サブエージェント + env の起動プリセット」。同じ購読内容で起動条件だけ違う Agent を並べるために Channel から独立させる。Agent は Channel を 1 つだけ持つ（MCP 接続を 1 本に保つため）。

Agent に直接 Connector を持たせない、Channel に bot token を持たせない。
