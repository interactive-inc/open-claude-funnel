---
name: funnel
description: Use when the user asks about the `funnel` / `fnl` CLI — a hub that routes Slack / GitHub / Discord events and cron triggers into Claude Code via subscription channels. Surfaces command groups and architecture; defers all flag/argument details to `funnel <command> --help`.
---

# funnel

外部サービス（Slack / GitHub / Discord）と時間トリガ（cron schedule）からのイベントを、購読チャネル経由で Claude Code に流す hub CLI。コマンドは `funnel`、ショートエイリアスは `fnl`。

## アーキテクチャ

```
External sources (Slack / GitHub / Discord / cron)
        │
        ▼
   Connectors  (~/.funnel/connectors/<type>/<name>.(json|jsonl))
        │
        ▼
    Channels   (~/.funnel/settings.json)
        │
        ▼  WebSocket
  Gateway daemon
        │
        ▼  MCP (stdio)
   Claude Code
```

- Connector: 外部接続の単位。type は `slack` / `gh` / `discord` / `schedule`
- Channel: 1 つ以上の Connector を購読する箱
- Gateway: 全 Connector を listen し、Channel ごとに WebSocket 配信する daemon
- Profile: 起動設定の名前付きプリセット
- Repository: funnel MCP を `.mcp.json` に登録するリポジトリ

## コマンドグループ

| Group | 役割 |
|---|---|
| `fnl connectors` | Slack / GitHub / Discord / schedule の登録・更新・削除 |
| `fnl connectors <name> schedules` | schedule connector の cron エントリ管理 |
| `fnl channels` | 購読箱の作成・connector の attach / detach |
| `fnl profiles` | 起動プリセット |
| `fnl repos` | `.mcp.json` 登録対象のリポジトリ管理 |
| `fnl gateway` | gateway daemon の起動・停止・ログ |
| `fnl claude` | Claude Code を profile か raw 設定で起動 |
| `fnl request slack` / `fnl request discord` | connector 経由で外部 API を叩く |
| `fnl status` | 全体のステータスを表示 |
| `fnl update` | funnel 本体を更新 |

## 詳細を調べる

引数・オプションの正は CLI の `--help`。**SKILL からは詳細を推測せず、必ず `--help` を確認する。**

```bash
fnl --help
fnl <group> --help
fnl <group> <subcommand> --help
```

例:

```bash
fnl connectors add --help
fnl connectors my-cron schedules add --help
fnl channels --help
fnl gateway start --help
```

## 典型ワークフロー

```bash
# 1. connector を登録
fnl connectors add my-slack --type slack --bot-token xoxb-... --app-token xapp-...

# 2. channel を作って attach
fnl channels add my-inbox
fnl channels my-inbox connectors attach my-slack

# 3. gateway を起動
fnl gateway start

# 4. Claude Code を起動（cwd の .mcp.json に funnel が自動登録される）
fnl claude --channel my-inbox
```

schedule (cron) の場合:

```bash
fnl connectors add daily --type schedule
fnl connectors daily schedules add --cron "0 9 * * *" --prompt "morning standup"
fnl channels my-inbox connectors attach daily
```

## 設定の在りか

- `~/.funnel/settings.json` — channels / repositories / profiles
- `~/.funnel/connectors/<type>/<name>.(json|jsonl)` — connector ごとの実体
- `~/.funnel/connectors/schedule/<name>.state.json` — cron 発火履歴（catch-up 用）
- `~/.funnel/gateway.pid` / `~/.funnel/claude/<profile>.pid` — プロセス PID
- `/tmp/funnel/events/*.jsonl` — イベントログ
- `/tmp/funnel/gateway.log` — gateway プロセスログ

## 注意

- フラグやサブコマンドの構文は推測しない。必ず `--help` を見る
- breaking change が入っている可能性があるため、ローカルの `funnel --version` と挙動を信用する
