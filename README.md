# @interactive-inc/claude-funnel

[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

複数の Claude Code と外部サービス（Slack / GitHub / Discord）を繋ぐハブ CLI。外部通知を「購読箱」経由で Claude Code セッションに流し込み、Claude から外部 API への呼び出しもまとめて扱う。

コマンドは `funnel` または短縮形 `fnl`。

## 全体像

```
Slack/他            Connectors      Channels (購読箱)       Claude Code
(外部API)   ──→    (funnel)   ──→   (購読ルーティング)  ──WS/MCP──→   (<channel> タグで受信)
                                                           ↑
                                               funnel MCP サーバ (funnel mcp)
```

## 必要環境

- [Bun](https://bun.sh) 1.3 以上（ランタイム）
- [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI
- Slack / GitHub / Discord いずれかのトークンまたは CLI（使う Connector に応じて）

## インストール

```bash
bun add -g @interactive-inc/claude-funnel
```

インストール後、`funnel` / `fnl` がグローバルコマンドとして使える。

## クイックスタート

```bash
# 外部接続 (Connector) を登録
fnl connectors add my-slack --type slack --bot-token xoxb-... --app-token xapp-...

# 購読箱 (Channel) を作って Connector を繋ぐ
fnl channels add my-inbox
fnl channels my-inbox connectors attach my-slack

# gateway を起動（Slack Socket Mode に接続）
fnl gateway start

# Claude を起動（カレントディレクトリの .mcp.json に funnel が自動登録される）
fnl claude --channel my-inbox
```

## コマンド一覧

```
fnl connectors                              一覧
fnl connectors add <name> --type <t> --bot-token <t> --app-token <t>
fnl connectors <name>                       詳細
fnl connectors <name> set [--bot-token ...] [--app-token ...]
fnl connectors rename <old> <new>
fnl connectors remove <name>
fnl connectors <name> <method> <path> [body]   API 直叩き (get/post/put/delete/...)

fnl channels                                一覧
fnl channels add <name>
fnl channels <name>                         詳細
fnl channels <name> connectors attach <connector>
fnl channels <name> connectors detach <connector>
fnl channels rename <old> <new>
fnl channels remove <name>

fnl agents                                  エージェントプリセット一覧（おまけ）
fnl agents add <name> --channel <c> [--repo <r>] [--sub-agent <s>] [--env-file <f>]
fnl agents <name>                           起動（fnl claude の糖衣）
fnl agents <name> set [--channel ...] [--repo ...] [--sub-agent ...] [--env-file ...]
fnl agents rename <old> <new>
fnl agents remove <name>

fnl repos                                   リポジトリ一覧（おまけ）
fnl repos add <name> --path <path>          .mcp.json に funnel MCP を自動追加
fnl repos <name>                            詳細
fnl repos <name> set [--path <path>]
fnl repos rename <old> <new>
fnl repos remove <name>

fnl claude --channel <c> [--repo <r>] [--sub-agent <s>] [--env-file <f>]
                                            Claude Code を起動
fnl mcp                                     MCP サーバとして起動（.mcp.json から呼ばれる）

fnl gateway                                 稼働状態
fnl gateway start / stop / restart / run / logs
fnl status                                  全体状況（connectors / channels / agents / repos / gateway）

fnl --version
fnl --help        （各サブコマンドに --help あり）
```

## データモデル

```
Connector =
  | { type: "slack",   name, botToken, appToken }          Slack Socket Mode
  | { type: "gh",      name, pollInterval? }                GitHub (gh CLI)
  | { type: "discord", name, botToken }                     Discord Gateway

Channel    = { name, connectors[] }                        購読箱
Repository = { name, path }                                 おまけ
Agent      = { name, channel, repo?, subAgent?, envFiles? } プリセット（おまけ）

Settings = { connectors[], channels[], repositories[], agents[] }
         → ~/.funnel/settings.json
```

## Discord Bot を使う場合

- Discord Developer Portal で Bot を作成し Token を取得
- Privileged Gateway Intents で `Message Content Intent` を有効化
- OAuth2 → URL Generator で `bot` scope、`View Channels` / `Send Messages` / `Read Message History` 権限付きで招待

## 環境変数

| 変数                 | 用途                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `FUNNEL_CHANNEL_ID`  | `fnl claude` が子プロセスに注入。funnel MCP がこれを見て gateway に購読接続 |
| `FUNNEL_PORT`        | gateway のポート（デフォルト 9742）                                         |
| `FUNNEL_GATEWAY_URL` | MCP 側の gateway WebSocket URL（デフォルト `ws://localhost:9742/ws`）       |

## ファイル配置

- 設定: `~/.funnel/settings.json`
- PID: `~/.funnel/gateway.pid`
- イベントログ: `/tmp/funnel/events/*.jsonl`（30 日で自動削除）
- プロセスログ: `/tmp/funnel/gateway.log`

## リンク

- [GitHub](https://github.com/interactive-inc/claude-funnel)
- [Issues](https://github.com/interactive-inc/claude-funnel/issues)
- コード規約と設計原則: [CLAUDE.md](https://github.com/interactive-inc/claude-funnel/blob/main/CLAUDE.md)
- 設計ドキュメント: [`.docs/`](https://github.com/interactive-inc/claude-funnel/tree/main/.docs)

## 開発

```bash
git clone https://github.com/interactive-inc/claude-funnel.git
cd claude-funnel
bun install
bun link            # funnel / fnl をグローバル登録
bun test            # テスト
bunx tsc -b         # 型チェック
```

## ライセンス

MIT © Interactive Inc.
