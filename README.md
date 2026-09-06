[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

# Open Claude Funnel

Slack のメンション、GitHub の Issue、毎朝 9 時の cron。こうした外部の出来事を Claude Code エージェントに届け、エージェントの返信を同じ経路で外へ返すハブ。

```
   Slack    ─┐                       ┌─→  Claude エージェント A
   GitHub   ─┤                       │
   Discord  ─┼──→  funnel daemon  ──→┼─→  Claude エージェント B
   cron     ─┘                       │
                                     └─→  Claude エージェント C

   funnel daemon が外部接続を1か所に常駐保持し、購読中の各エージェントへ配信する。
   返信は同じコネクタを逆向きに通る（エージェント → MCP tool → 外部サービス）。
```

コマンドは `funnel`（短縮形 `fnl`）。Claude Code を中心に作っているが、アーキテクチャはエージェント非依存。現在のバージョンは `0.53.0`。

## funnel がやること

- 外部の出来事（チャットのメンション、新しい Issue、cron の tick）を、起動中のエージェントセッションにそのまま届ける
- エージェントの返信を受信と同じコネクタで外へ返す。bash サブシェルも CLI のコールドスタートもなく、実質同期
- 外部接続は常駐デーモンが 1 か所で持つ。エージェントを何個起こしても接続は 1 回だけ。ヘルスチェックと自動再起動で監視する
- 複数のエージェントで 1 つのソースを共有（fanout）するか、ワーカーとして分担（exclusive）するかを選べる

対応コネクタは Slack（Socket Mode）、GitHub（`gh` 経由の poll）、Discord（Gateway）、cron スケジュールの 4 種類。

## 必要なもの

- [Bun](https://bun.sh) 1.3 以降
- [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI
- 接続する外部サービスのトークンまたは CLI（Slack アプリ、`gh` 認証、Discord bot など）

## リポジトリで使う（推奨）

設定を `funnel.json` としてリポジトリに commit し、チームで共有・バージョン管理できる。グローバルに何も入れないので、リポジトリの lock ファイルでバージョンが固定される。

### インストール

```bash
bun add -D @interactive-inc/claude-funnel
```

これで `bunx funnel`（または `bunx fnl`）が使える。

### 設定

リポジトリ直下に `funnel.json` を置く。transport（`channels[]`）と起動レシピ（`profiles[]`）を宣言する。

```json
{
  "$schema": "./node_modules/@interactive-inc/claude-funnel/funnel.schema.json",
  "channels": [
    {
      "name": "ops",
      "connectors": [{ "type": "slack", "name": "my-slack" }]
    },
    {
      "name": "review"
    }
  ],
  "profiles": [
    {
      "name": "pm",
      "channel": "ops",
      "options": ["--brief", "--agent", "pm"],
      "env": { "ANTHROPIC_MODEL": "claude-sonnet-4-6" },
      "resume": true
    },
    {
      "name": "reviewer",
      "channel": "review",
      "options": ["--agent", "reviewer"]
    }
  ]
}
```

channels は購読箱（transport）。各チャネルは `connectors` を持てる。`connectors` 配列はそのチャネルの真実の源で、起動時に宣言にないコネクタは削除され、足りないコネクタは作られる（名前で照合）。`connectors` フィールド自体が無ければ既存のコネクタはそのまま残る。

profiles は起動レシピ。各プロファイルは一意な `name` を持ち、`channel` でチャネルを名前指定でバインドし、次を持つ。

- `options` — claude の argv 先頭に積む（ユーザーが渡す CLI 引数はその後ろ。`--brief` / `--agent <name>` / `--model <name>` などに使う）
- `env` — 起動する claude プロセスに被せる（衝突時は起動シェルの `process.env` が勝つ）
- `resume` — claude セッションの再利用可否

同じチャネルに複数のプロファイルをバインドしてよく、`name` で区別する。チャネル側がプロファイルを選ぶことはない（プロファイルがチャネルを bind する一方向）。

トークンは `funnel.json` に書かない（スキーマが弾く）。リポジトリ内で次のどちらか。

- `fnl channels ops connectors set my-slack --bot-token=xoxb-... --app-token=xapp-...` で設定する
- 省略して `fnl claude` 起動時の TTY プロンプトで答える。次回以降は引き継がれ再度聞かれない

いずれもトークンは `~/.funnel/projects/<id>/settings.json`（リポジトリ外）に保存され、commit されない。

`funnel.json` に書けないものが 2 つある。delivery モード（fanout / exclusive）は CLI で設定する（`funnel.json` のチャネルは fanout 固定）。schedule の cron エントリも CLI で足す（`funnel.json` には schedule コネクタの存在だけ宣言できる）。

セッション再開には `resume` の明示が要る。`funnel.json` の `resume` はデフォルト値を持たず、書かないと再開されない（未指定が false 扱いになる）。前回の claude セッションを引き継ぎたいなら必ず `"resume": true` を書く。再開のための session id は funnel が `~/.funnel/projects/<id>/claude/local-sessions.json` に自動で保存・読み出しするので、`funnel.json` には書かない。

### 使い方

```bash
bunx fnl gateway start              # 常駐デーモンを起動（外部接続を持つ）
bunx fnl claude --profile pm        # cd + チャネルのバインド + レシピを一発で
```

`--profile` なしの `bunx fnl claude` は、`funnel.json` の先頭チャネルで起動する。`--channel review` で名前指定すると、そのチャネルを transport だけバインドして起動する（レシピなし）。

これでコネクタが見たイベントが、起動中のエージェントセッションに届く。エージェントは `my-slack` という MCP ツールで返信できる。

cron 起動を足す（schedule コネクタを宣言したうえで、エントリは CLI で）。

```bash
bunx fnl channels ops connectors add daily --type=schedule
bunx fnl channels ops connectors daily schedules add morning \
    --cron="0 9 * * *" --prompt="morning standup"
bunx fnl channels ops connectors daily schedules add release \
    --run-at="2026-08-01T09:00:00+09:00" --prompt="release check"
```

cron は一致する tick ごと、一回実行は `run-at` 以降の最初の tick でプロンプトを発火する。発火済みの一回実行は state に記録されるため、設定削除の hook が失敗しても再発火しない。デーモン停止中に逃した枠は次回起動時に catch-up する（`meta.catchup = "true"`。cron の探索は最大 24 時間）。

cron は標準の 5 フィールド規則に従う。day-of-month と day-of-week を両方限定した場合は OR、日曜は `0` と `7` の両方を受け付ける。不正な式は登録時に拒否される。

`funnel.json` を持つリポジトリは自分自身にスコープされる。初回起動時に funnel は `funnel.json` の先頭へ不変の `id`(uuid) を書き戻し、以降このリポジトリの funnel state を `~/.funnel/projects/<id>/` 配下に隔離する。グローバルの `~/.funnel` には一切触らない（イベントログと一時ファイルだけが `/tmp/funnel/` で共有）。このスコープはリポジトリ内で実行する全 CLI コマンドに効く。

トップレベルの `$schema`（任意）は JSON Schema を指し、エディタの検証と補完が効く。ローカルインストールでは `./node_modules/@interactive-inc/claude-funnel/funnel.schema.json` を推奨する（ネットワーク往復なし）。`https://interactive-inc.github.io/open-claude-funnel/funnel.schema.json` でも公開しており、`fnl schema > funnel.schema.json` でローカルコピーを再生成できる。

## グローバルで使う

触るすべてのリポジトリで 1 つの CLI を共有したいときはグローバルに入れる。設定は `funnel.json` ではなく CLI で組み、`~/.funnel/settings.json`（グローバル）に保存される。

```bash
bun add -g @interactive-inc/claude-funnel
```

これで `funnel` / `fnl` がどこでも使える。ソース 1 つをエージェント 1 つにつなぐ最短手順。

```bash
fnl channels add ops
fnl channels ops connectors add my-slack --type=slack \
    --bot-token=xoxb-... --app-token=xapp-...
fnl gateway start
fnl claude --channel ops
```

delivery モードはチャネル作成時に選ぶ。`tap=all` は廃止されており、WS 購読は `?id=<uuid>` の targeted delivery のみ。

```bash
fnl channels add reviews                       # fanout（デフォルト）: 全エージェントが全イベント
fnl channels add ingest --delivery=exclusive   # exclusive: 1 イベントを 1 エージェントが round-robin
```

ワンコマンド起動のためにプロファイルとして保存する。プロファイルは起動レシピを持つ。

```bash
fnl profiles add cto --path=/repo/myapp --channel=ops --agent=pm --options="--brief"
fnl claude --profile cto
```

公開パッケージはビルド済みの `dist/` を同梱しているので、どちらのインストールでも `funnel` / `fnl` がすぐ使える（post-install ステップなし）。リポジトリ単位で入れたなら、以降の `fnl` は `bunx funnel` に読み替える。

コマンドの一覧やフラグはここに並べない。`fnl --help` で全体、`fnl <command> --help`（例 `fnl channels --help`）で個別の使い方が出る。動詞だけを引数なしで打ってもヘルプが返る。

## なぜ funnel なのか

1 つのエージェントセッションは、1 つのリポジトリ・1 つの瞬間を扱うのは得意だ。だがそれに「何かに反応させたい」と思った瞬間 — チャットのメンション、新しい Issue、朝 9 時のスタンドアップ — シェルスクリプトと cron と `bash -c "agent ..."` をつなぎ合わせる羽目になる。「誰が何を聞いていて、誰がどこに返信していいのか」を一望できる場所がどこにもない。

funnel はその場所になる。名前付きの購読箱（チャネル）を宣言し、コネクタを取り付け、チャネルをバインドしてエージェントを起動すれば、あとはデーモンが面倒を見る。使うモチベーションは次の点にある。

外部接続をデーモンが 1 か所で持つ。各接続は、エージェントセッションを何個起こしても 1 回だけつながる。2 つ目のエージェントが 2 つ目のソケットを開くことはなく、両方が同じチャネルを購読し、デーモンがイベントを fanout する。

受信イベントは MCP 通知として届くので、エージェントは今いるセッションのまま反応する。新しいプロセスを起こさない。

送信（返信）はコネクタごとの MCP ツールを使う。bash も CLI のコールドスタートもなく、実質同期で返る。

リスナーはヘルスチェックと自動再起動で監視される。接続が不安定でも poller がクラッシュしても、自分で復旧する。

複数のエージェントが 1 つのチャネルを共有する（fanout）か、ワーカーとしてイベントを取り合う（exclusive）かを選べる。どのイベントを誰が受けるかはデーモンが決める。

つまり、外部とのつなぎ込みという「配管」を 1 つのデーモンに集約し、エージェント側は購読と返信という単純な世界だけを見ればよくなる。これが funnel を使う理由になる。

## 仕組み

### 全体像

```
external sources                          outbound replies
(chat / source-control / cron)            (MCP tools per connector)
        │                                          │
        ▼                                          ▼
            daemon  (port 9743 for CLI)
            routes events into channels
            serves replies through the same connectors
                        │
                        ▼  WebSocket / MCP (stdio)
                     agent  (subscribes to one channel)
```

### Channel と Connector と Profile

transport モデルは 2 つの概念でできている。

Channel は名前付きの購読箱（transport のみ）。1 つ以上のコネクタと delivery モードを持ち、起動フラグは持たない。エージェントセッションはちょうど 1 つのチャネルを購読する。WS 接続は `?id=<uuid>` の targeted delivery のみで、`tap=all` は廃止されている。delivery は `fanout`（全 subscriber が全イベントを見る、デフォルト）か `exclusive`（1 イベントを 1 subscriber が round-robin で消費、ワーカープール向け）。

`exclusive` の再接続では同じ `id` と最後に配送を完了した `since` を渡す。配送先を永続化するため、別ワーカーへ配送済みのイベントは再送されない。接続者がいない間のイベントは、最初に再送を要求したワーカーへ割り当てる。MCP クライアントはプロセス内で同じ `id` を維持する。自作クライアントで `id` を省略した場合は接続中の配送のみを利用でき、`exclusive` の `since` 指定には `id` が必須。

再送用の本文は全文保存する。旧バージョンで既に切り詰められた本文は復元されず、配送先の記録がない旧イベントは `exclusive` では再送しない。同じワーカーへの再送はあり得るため、外部への副作用の完了を一度だけにする保証とは別である。コネクタの改名・追加や配送モードの変更は、次の送信時に接続済みクライアントにも反映する。存在しないチャネルへの publish は HTTP 404（SDK は `FunnelChannelNotFoundError`）になる。

Connector はチャネルから外部ソースへの 1 つの接続。`slack` / `gh` / `discord` / `schedule` の 4 型。前者 3 つは双方向（イベント入力・返信出力）、`schedule` は一方向（cron tick の入力のみ）。

Profile はその transport モデルの外側にある起動の便宜レイヤで、モデルの一部ではない。エージェントを動かすのに必須ではない（`fnl claude --channel <name>` で足りる）。`{ path, channelId, options, env, resume }` を束ねた保存済みの起動 preset で、`fnl claude --profile cto` が既知のセットアップを再現する。どのディレクトリから起動するか、どのチャネルをバインドするか、起動レシピ（claude argv の先頭に積む引数、プロセスに被せる env、セッション再利用）をまとめて持つ。プロファイルは不変の uuid `id` を持ち（PID ファイルと再開可能なセッションがこれをキーにするので、rename してもどちらも迷子にならない）、`name` は人が打つハンドル。プロファイルは既にチャネルをバインドしているので、`--profile` と `--channel` は併用できない。

### daemon

外部接続はすべてデーモンに住む。`funnel` CLI 起動では port 9743 で動く（プログラムから起こす gateway は 9742 なので、1 マシン上で衝突しない。`FUNNEL_PORT` でどちらも上書き可）。bind は loopback（`127.0.0.1`）のみで off-box から到達不可。`FUNNEL_HOST=0.0.0.0` で意図的に公開できる（公開しても全特権エンドポイントは bearer token 必須）。デーモンはコネクタを自動再起動付きで監視し、イベントを WebSocket で購読中のエージェントセッションへ broadcast し、MCP が呼ぶ返信 API を提供する。エージェントの起動・停止が外部接続を起動・停止することはない。

### MCP

MCP レイヤはエージェントへの薄いブリッジ。バインドされたチャネルを WebSocket で購読し（実作業はデーモンがやる）、呼び出し可能なコネクタごとに 1 つのツールを公開して、エージェントが外へ返信できるようにする。

### イベントの旅

1 つの Slack メッセージがエージェントに届くまで。

```
Slack → SlackListener.start(notify) → notify(channel, connector, content, meta)
     → GatewayServer.notify → Broadcaster.broadcast → event store に seq 付き保存
     → 該当 Channel を購読している WS クライアントに fanout
     → エージェント側 MCP（channel-server）が受信してエージェントに events として渡す
```

逆方向（エージェント → Slack）は MCP のコネクタごとの tool 経由。Listener と Adapter は独立した一方向の通路で、Broadcaster は経由しない。

### 外部への送信

`fnl claude` がエージェントを起動すると、funnel の MCP サーバがデーモンに接続し、チャネルのコネクタを `~/.funnel/settings.json` から読む。呼び出し可能なコネクタ（`slack` / `discord` / `gh`。`schedule` は一方向なので除外）ごとに、コネクタ名のツールを 1 つ公開する。エージェントはこう呼ぶ。

```jsonc
// MCP: tools/list が返す
{ "name": "discord",   "inputSchema": { ... { method, path, body } ... } }
{ "name": "ops-slack", "inputSchema": { ... } }
{ "name": "gh-main",   "inputSchema": { ... } }

// エージェントの呼び出し
tools/call name="discord" arguments={
  "method": "POST",
  "path": "/channels/123/messages",
  "body": { "content": "got it" }
}
```

MCP は HTTP `POST /channels/<channel>/connectors/<connector>/call` でデーモンへ転送し、デーモンがコネクタの adapter 経由でディスパッチする。bash サブシェルもコールドスタートもなく、返信は実質同期。

エージェントの外からコネクタを呼ぶには、同じパスを `fnl channels <ch> connectors <c> request --method=<...> [--key=value ...]` で叩ける。

### データモデル

```
Channel    = { id, name, delivery, connectors[] }
        購読箱（transport のみ）。delivery は `fanout`（全 WS クライアントが全イベント受信）
        か `exclusive`（round-robin で 1 イベント 1 クライアント）。起動設定は持たない。

Connector  =
  | { type: "slack",    name, botToken, appToken }      Slack Socket Mode
  | { type: "gh",       name, pollInterval? }           GitHub（gh CLI, poll ベース）
  | { type: "discord",  name, botToken }                Discord Gateway
  | { type: "schedule", name, entries[] }               cron 起動。entries = { id, cron, prompt, enabled?, catchupPolicy? }

Profile    = { id, name, path, channelId, options[], env, resume, sessionId? }
        名前付き起動 preset: どこで起動するか（path）、どのチャネルをバインドするか、起動レシピ。
        options[] は claude argv の先頭に積み、env はプロセスに被せ（衝突時は process.env が勝つ）、
        resume はセッション再利用を切り替える。先頭がデフォルト。id は不変の uuid（PID ファイルと
        再開可能セッションがぶら下がるキー。rename でどちらも迷子にしない）、name は CLI のハンドル。
        sessionId は config ではなく実行状態で、このプロファイルが最後に起動した claude セッション。
        launcher が書き、次回 resume で読み戻す。

LocalConfig = { id?, channels: ChannelSpec[], profiles?: ProfileSpec[] }
        リポジトリ単位のファイル（funnel.json）。channels[] 必須、先頭がデフォルト、--channel で選ぶ。
        id（uuid）は初回起動時に書き戻され、このリポジトリの funnel state は
        ~/.funnel/projects/<id>/ 配下に住み、グローバルの ~/.funnel には一切触れない。

ChannelSpec = { name, connectors? }
        transport 宣言（funnel.json は名前で宣言するので id はない）。connectors は起動時に
        ~/.funnel/projects/<id>/settings.json の該当 Channel に materialize する。コネクタはトークンを
        持たず、CLI か TTY 起動時のプロンプトで設定し、そのスコープ settings に保存される。

ProfileSpec = { name, channel, options?, env?, resume? }
        チャネルに名前でバインドする起動レシピ。`fnl claude --profile <name>` で name 解決して適用され、
        グローバルの profiles[] リストには永続化されない。

Settings   = { channels[], profiles[] }                 → ~/.funnel/settings.json（グローバル）
                                                          または ~/.funnel/projects/<id>/settings.json（リポジトリ単位の funnel.json）
```

### ファイルレイアウト

永続データは `~/.funnel/` 配下、揮発ログとイベントログは `/tmp/funnel/` 配下に住む。

```
~/.funnel/
├── settings.json                                       グローバルの channels[]（nested connectors）, profiles[]
├── projects/
│   └── <id>/                                           funnel.json を持つリポジトリのスコープ state
│       └── settings.json, gateway.token, claude/, ...  （グローバルと同じレイアウト、funnel.json id でスコープ）
├── gateway.pid                                         デーモン PID
├── gateway.token                                       デーモン HTTP / WS の Bearer token
├── claude/
│   ├── <profile-id>.pid                                同一プロファイルの二重起動を防ぐ（profile id がキー）
│   └── local-sessions.json                             funnel.json profile の再開用 session id
└── channels/
    └── <channel-id>/
        └── connectors/
            └── <connector-id>/
                └── state.json                          コネクタごとの永続 state（例: schedule の lastFiredAt）

/tmp/funnel/
├── events/<scope>.db                                   dir + port ごとに分離した offset 再生ログ
├── funnel.log                                          診断ログ（デーモンの起動、listener boot、接続）
└── gateway.log                                         デーモンの stdout/stderr
```

コネクタの設定は settings.json にインライン（チャネルの下に nested）で保存され、型ごとのディレクトリには置かない。コネクタごとの永続 state（schedule catch-up の `lastFiredAt` など）は `channels/<channel-id>/connectors/<connector-id>/state.json` に id をキーに住むので、rename しても state を失わない。`fnl gateway logs` は `funnel.log` を tail して YAML として描画する。

### 環境変数

- `FUNNEL_CHANNEL_ID` — `fnl claude` が子プロセスに注入する。funnel MCP がこれで購読する
- `FUNNEL_PORT` — gateway ポート。`funnel` CLI 起動はデフォルト 9743、プログラムから起こす gateway は 9742
- `FUNNEL_GATEWAY_URL` — MCP が WS 購読と HTTP 返信の両方で使うデーモンのベース URL（デフォルト `http://127.0.0.1:<port>`）
- `FUNNEL_GATEWAY_TOKEN` — デーモン HTTP / WS の Bearer token。デフォルトは `~/.funnel/gateway.token` の中身

## Discord bot のセットアップ

- Discord Developer Portal で bot を作りトークンを取得する
- Privileged Gateway Intents の `Message Content Intent` を有効にする
- OAuth2 → URL Generator で `bot` スコープと `View Channels` / `Send Messages` / `Read Message History` 権限を付けて招待する

## プログラマブル API（Bun）

CLI を介さず、ライブラリとして組み込める。CLI が使うのと同じ `Funnel` facade をパッケージのルートから export している。`new Funnel()` は constructor で全依存を即座に組み立てて freeze する（完全イミュータブル）。

コネクタは完全 DI。使う型の descriptor を `connectors` に渡したぶんだけが扱われ、渡さなければコネクタゼロ。core の import（`import { Funnel }`）にはコネクタの SDK（@slack/bolt, discord.js）が一切載らず、サブエントリ（`@interactive-inc/claude-funnel/connectors/<type>`）から descriptor を import したときだけバンドルに入る。

```ts
import { Funnel } from "@interactive-inc/claude-funnel"
import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"

const funnel = new Funnel({ connectors: [slackConnector()] }) // ~/.funnel + /tmp/funnel がデフォルト

const channel = funnel.channels.add({ name: "inbox" })
funnel.channels.addConnector("inbox", {
  type: "slack",
  name: "my-slack",
  botToken: "xoxb-...",
  appToken: "xapp-...",
})
```

Schedule の起動フックは descriptor factory の引数で渡す（`scheduleConnector({ onFired })`）。Slack / Discord / GitHub は `@interactive-inc/flume` 0.6 の `Flume` FSM を通して接続する（source の ctor は protocol 専用 option だけ、`onEvent` / `onLog` / `onStatus` / `reconnect` / `signal` / `deps` は Flume 側に集約）。これらの host 拡張用フックは持たないので、必要なら自前 descriptor を書く。host shutdown を伝播させたい場合は `new Funnel({ signal: controller.signal })` で `AbortSignal` を渡すと、全 connector の Flume へ自動転送される。

`channels` / `profiles` / `gateway` / `listeners` / `claude` / `localConfig` / `localConfigSync` / `diagnostics` / `doctor` / `recovery` / `docs` / `gatewayToken` / `publisher` / `paths` がすべて同じインスタンスの readonly プロパティとして辿れる。`gateway` はデーモンの起動・停止、`listeners` は動作中デーモンとの HTTP 会話、`claude` はエージェント起動、`diagnostics` / `doctor` / `recovery` は読み取り診断と自己修復を担う。

```ts
await funnel.gateway.start() // デーモンを別プロセスとして spawn
funnel.gateway.getStatus() // { running, pid, port }

await funnel.listeners.start("inbox", "my-slack")
await funnel.listeners.restart("inbox", "my-slack")

await funnel.claude.launch({ channel: "inbox" }) // claude を起動（.mcp.json も自動で書く）

// profiles / localConfig / localConfigSync も直接アクセス可
funnel.profiles.add({ name: "pm", path: "/repo", channelId: channel.id })
```

デーモンを spawn せず、gateway をインプロセスで動かすこともできる（テストや埋め込み向け）。`onEvent` で全 broadcast イベントをインプロセスで観測できる。

```ts
const server = funnel.gatewayServer({ port: 9742 })
await server.start() // Bun.serve (HTTP + WS) + listener registry
const unsubscribe = server.onEvent(({ content, meta }) => {
  console.log(meta?.connector, content)
})
await server.stop()
unsubscribe()
```

永続化と再生は `FunnelEventLog` port の裏にある。デフォルトは `SqliteFunnelEventLog`（デーモン再起動を跨いで durable。reconnect 時の再生を提供する）。`gatewayServer({ eventLog })` に `MemoryFunnelEventLog` を渡せば durable な再生を差し替え・無効化できる。`onEvent` は書き込み専用の観測フックで、再生（読み戻し）は EventLog の責務。

### 間違えにくい API

URL やオプションは型で安全側に倒している。

```ts
import {
  channelWsUrl,
  channelWsProtocols,
  gatewayLoopbackUrl,
} from "@interactive-inc/claude-funnel/gateway"

// WS 購読 URL。channel は必須（付け忘れるとコンパイルエラー）。
const url = channelWsUrl({ base: "ws://localhost:9743/ws", channel: "inbox", subscriberId })
const ws = new WebSocket(url, channelWsProtocols(token)) // token は subprotocol で渡す

// HTTP の loopback base は手で組まずこれを使う
const base = gatewayLoopbackUrl(9743) // → http://127.0.0.1:9743
```

- 非ループバック bind（`gatewayServer({ hostname: "0.0.0.0" })`）は token 無しだと `start()` が throw する。前段で自前認証する場合のみ `allowInsecureHost: true`
- コネクタの token は `botToken` か `botTokenEnv` の片方だけ（両方同時はコンパイルエラー）、event store は `dbPath` か `eventLog` の片方だけ、launch の `resume` は stable な `profileId` がある時だけ指定できる

### サブエントリ

個別の層だけを import したい場合は sub-entry を使う。

```ts
// in-process gateway building blocks（FunnelGatewayServer, FunnelBroadcaster 等）
import { FunnelGatewayServer } from "@interactive-inc/claude-funnel/gateway"

// 名前付き起動プロファイル管理
import { FunnelProfiles } from "@interactive-inc/claude-funnel/profiles"

// funnel.json reader / writer / syncer
import { FunnelLocalConfig } from "@interactive-inc/claude-funnel/local-config"

// コネクタの descriptor とスキーマ（Slack / Discord / GitHub / Schedule）
// descriptor（slackConnector 等）を new Funnel({ connectors: [...] }) に渡す
import {
  slackConnector,
  slackConnectorSchema,
} from "@interactive-inc/claude-funnel/connectors/slack"

// Channel manifest（flume sources を broadcaster に流す宣言的 channel。ConnectorDescriptor 系とは独立）
import {
  FunnelChannelSupervisor,
  timeChannel,
  defineChannel,
} from "@interactive-inc/claude-funnel/channel"
```

汎用のstructured event logは製品APIから独立したサブエントリです。
新しいコードではこちらを使います。

```ts
import { EventLog, MemoryEventLog } from "@interactive-inc/claude-funnel/event-log"
```

既存の `@interactive-inc/claude-funnel/logger` と `FunnelLog` 系は互換性のため
維持しています。text diagnostic logも引き続きloggerサブエントリにあります。

### テスト用のサンドボックス

`Funnel.inMemory()` は全 IO 境界（ディスク / プロセス / clock / UUID）を Memory 実装で配線済みの Funnel を返す。`props` の任意の部分集合で個々の seam を上書きできるので、実 FS や spawn に触れずにテストを書ける。

```ts
import { MemoryFunnelTokenPrompter } from "@interactive-inc/claude-funnel"

const funnel = Funnel.inMemory({
  tokenPrompter: new MemoryFunnelTokenPrompter(), // TTY プロンプトを差し替え
})
funnel.channels.add({ name: "inbox" }) // インメモリ store を変更する
```

`fnl` を支える Hono アプリ（`cliRoutes` / `toRequest`）や、各コネクタの Zod スキーマも export している。詳細は型定義を参照。

## Claude Code skill

このリポジトリは `.claude/skills/funnel/SKILL.md` に Claude Code skill を同梱している。アーキテクチャとコマンド群を Claude に説明し、フラグレベルの詳細は `funnel <command> --help` に委ねるよう指示する。

プロジェクトスコープ（自動）: このリポジトリ内で `claude` を実行すると skill が自動で読まれる。インストール手順は不要。

グローバル（任意のプロジェクトで使う）: Claude Code はリモート URL から skill をインストールする CLI を今のところ提供していないので、ファイルを個人の skills ディレクトリへコピーする。

```bash
# このリポジトリの clone から
mkdir -p ~/.claude/skills/funnel
cp .claude/skills/funnel/SKILL.md ~/.claude/skills/funnel/
```

clone せず直接取得することもできる。

```bash
mkdir -p ~/.claude/skills/funnel
curl -fsSL https://raw.githubusercontent.com/interactive-inc/open-claude-funnel/main/.claude/skills/funnel/SKILL.md \
  -o ~/.claude/skills/funnel/SKILL.md
```

これで Claude Code がどのセッションでも skill を読む。

## 開発

```bash
git clone https://github.com/interactive-inc/open-claude-funnel.git
cd open-claude-funnel
bun install         # 依存インストール（自動ビルドなし）
make build          # dist/ を生成 — install 後に一度実行
bun link            # fnl / funnel → dist/bin.js を symlink
make build          # 編集後にライブラリ + CLI を再ビルド
make build-lib      # ライブラリのみ（vp pack）
make build-bin      # CLI / daemon のみ（bun build --minify）
make clean          # dist/ を削除
bun test            # テスト実行
bunx tsc -b         # 型チェック
bun lib/bin.ts ...  # ソースから CLI を実行（ビルド不要、高速イテレーション）
```

## リンク

- [GitHub](https://github.com/interactive-inc/open-claude-funnel)
- [Issues](https://github.com/interactive-inc/open-claude-funnel/issues)
- コーディング規約と設計原則: [CLAUDE.md](https://github.com/interactive-inc/open-claude-funnel/blob/main/CLAUDE.md)

## ライセンス

MIT © Interactive Inc.
