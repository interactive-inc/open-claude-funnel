# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Claude Funnel (`funnel` / `fnl`) は、複数の Claude Code エージェントと外部サービス（Slack 等）を統合管理するハブ。外部の通知が購読箱に流れ、各 Claude が購読箱経由でイベントを受け取る。

```
Connectors (Slack 等) ─→ Channels (購読箱) ─WebSocket→ Claude (MCP)
```

## Commands

```bash
bun install          # 依存インストール
bun link             # funnel / fnl をグローバル登録
bunx tsc -b          # 型チェック
bun test             # テスト実行
```

## Architecture

CLI の引数を内部 HTTP リクエストに変換し、Hono アプリでルーティングする構造。実際のネットワーク通信は発生しない。

```
lib/
├── index.ts            エントリポイント。argv → app.request()
├── factory.ts          createFactory() の唯一の呼び出し場所
├── funnel.ts           Funnel class（全 Service を束ねる Facade、公開 API）
├── routes.ts           中央。sub-Hono を mount
├── routes/             ルートハンドラ（connectors / channels / profiles / repos / claude / gateway / status / update）
└── modules/            ビジネスロジック。Hono 非依存
    ├── connectors/     FunnelConnectors + Adapter / Listener / EventProcessor 群
    ├── channels/       FunnelChannels（購読箱）
    ├── profiles/       FunnelProfiles（起動プロファイル）
    ├── claude/         FunnelClaude
    ├── repos/          FunnelRepositories
    ├── mcp/            FunnelMcp + channel-server
    ├── gateway/        FunnelGateway + daemon + Broadcaster / EventLogger
    ├── settings/       FunnelSettingsReader/Store + Zod スキーマ + Mock
    ├── fs/             FunnelFileSystem (abstract) + Node / Memory 実装
    ├── http/           FunnelHttpClient (abstract) + Node / Memory 実装
    ├── process/        FunnelProcessRunner (abstract) + Node / Memory 実装
    ├── router/         toRequest / queryToCliArgs / zValidator
    ├── tui/            OpenTUI + React（中央に "funnel" 表示の最小実装）
    └── logger.ts       共通ロガー（singleton）
```

## Design Rules

### CLI

- 対話禁止。全てオプション引数で完結する（Claude-first）
- `export default` 禁止
- 全ルートは `?help=true` に対してヘルプテキストを返す
- 全ルートは GET のみ（副作用も GET）

### Modules

- ビジネスロジックは `lib/modules/` のクラスに集約（Hono 非依存）
- `Funnel` class（`lib/funnel.ts`）が全 Service を束ねる Facade。プログラマブル API としても `new Funnel({ store })` で利用可
- クラスは DI（コンストラクタで依存を受け取る）
- `Object.freeze(this)` で immutable
- CLI と TUI は `Funnel` 経由で同じ API を共有
- `new ConnectorService({ store })` を薄くラップしただけの `createXxxService(store)` 関数は作らない（DI が複数になる場合のみ create 関数を置く）
- 外部境界（FS / HTTP / process / settings / adapter / listener）は abstract class を切り、Node 実装と Memory 実装を並置
- テストは Memory 実装で書く（実 FS / spawn / fetch / WebSocket に触れない）
- ルートハンドラでは try/catch を書かず、サービスは throw。`lib/routes.ts` の onError が捕捉して 400 テキストで返す
- ルートで `c.req.valid("param")` / `c.req.valid("query")` の結果は分割代入せず、`const param = ...` / `const query = ...` として保持する
- ルートは `const funnel = c.var.funnel` で Funnel を取得して使う（`lib/routes.ts` の base app に付けた `use("*", ...)` middleware で context に乗せる。sub-Hono の `factory` には initApp を設定しないこと — 二重生成を避けるため）
- CLI 経由で実行 argv を Claude Code に転送するときは `queryToCliArgs(url, RESERVED_KEYS)` を使い、funnel 自身の予約キーを除外する

### Settings

- ディレクトリ: `~/.funnel/`
- パス: `~/.funnel/settings.json`
- スキーマ: `lib/modules/settings/settings-schema.ts`（Zod v4）。型は `z.infer` で生成
- Slack トークンは `xoxb-` / `xapp-` プレフィックスで検証

### Gateway

- ポート: 9742（`FUNNEL_PORT` で変更可）
- PID: `~/.funnel/gateway.pid`
- イベントログ: `/tmp/funnel/events/*.jsonl`
- プロセスログ: `/tmp/funnel/gateway.log`
- `nohup` でバックグラウンド起動
- 全 Connector の Slack ソケットに同時接続
- WebSocket クライアントは `?channel=<name>` で接続し、そのチャネルが購読する Connector のイベントのみ受信
- Slack Socket Mode 起動時は、競合する bun + gateway/bolt/slack プロセスを自 PID 以外 kill する

### MCP Channel

- `lib/modules/mcp/channel-server.ts` — Claude Code の stdio MCP サーバ
- `FUNNEL_CHANNEL_ID` が未設定なら WebSocket 接続しない（no-op）
- `experimental: { "claude/channel": {} }` capability 必須
- 対象リポジトリの `.mcp.json` に登録が必要（`fnl repos add` で自動書き込み）

### Claude 起動

- `fnl claude` は "default" profile を起動。`fnl claude --profile <name>` で名前付き profile を起動
- `fnl claude --channel <name>` で profile を使わない raw 起動（`FUNNEL_CHANNEL_ID=<name>` を子プロセスに注入）
- `--repo <name>` で cwd を切り替え（おまけ）
- `--sub-agent <name>` で `claude --agent` に伝播
- `--env-file <file>` で追加 env 読込
- `fnl profiles <name> run` はプロファイルを展開した `fnl claude` の糖衣
- 同一 profile 名で起動中は二重起動を拒否。PID ファイル: `~/.funnel/claude/<name>.pid`

## Conventions

- ランタイム: Bun（ESM）
- パスエイリアス: `@/*` → `./lib/*`
- 言語: コード・CLI 出力・コメントは英語。ドキュメント (.md) は日本語
- `require()` 禁止。動的 import も禁止
- `let` / `var` 回避、`const` 優先
