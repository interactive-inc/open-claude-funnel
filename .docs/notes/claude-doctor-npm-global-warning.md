## 症状

`claude update` または `claude doctor` を実行すると、native 版が正常稼働しているのに次の警告が消えない。

```
⚠ Multiple installations found
├ npm-global at /Users/i/.local/bin/claude
└ native at /Users/i/.local/bin/claude

⚠ Leftover npm global installation at /Users/i/.local/bin/claude
  └ Run: npm -g uninstall @anthropic-ai/claude-code
```

同じパスを npm-global と native の両方として検出している。`npm -g uninstall @anthropic-ai/claude-code` を実行しても無効（そもそも入っていない）。

## 原因

`~/.npmrc` に prefix 設定が入っていた。

```
prefix=/Users/i/.local
```

これにより npm 的には `~/.local/bin` が「npm-global の bin ディレクトリ」になる。native installer が同じ `~/.local/bin/claude` に symlink を置く仕様なので、claude doctor の判定ロジックは「このパスは npm-global の場所」と認識し、同時に「実体は native」とも認識して両方を報告する。

`~/.npmrc` の prefix は claude とは無関係に過去設定したもので、claude installer が書き込んだものではない。

## 切り分けの過程

実体側に npm-global の痕跡はないことを順に確認した。

`which -a claude` は `~/.local/bin/claude` の 1 つだけ。PATH 上に他の claude バイナリなし。

`npm root -g` 配下に `@anthropic-ai/` ディレクトリなし。

`~/.local/lib/node_modules` は空。

`~/.npm/_npx/<hash>/node_modules/@anthropic-ai/claude-code` に過去の `npx` キャッシュが 2 件残っていたが、削除しても警告は消えなかった。

`~/.claude/.last-update-result.json` に `{"path":"npm-global","outcome":"failed",...}` が記録されており、`Last update attempt: failed (install_failed)` の出どころだったので削除。`Last update attempt: none recorded` になったが、Multiple installations 警告は別ソースで残った。

最後に `~/.npmrc` を確認したら `prefix=/Users/i/.local` が見つかった。これが native と同じディレクトリを指していたことが Multiple installations 検出の根拠。

## 対処

prefix 行だけ削除し、registry の auth token は保持。

```
sed -i '' '/^prefix=/d' ~/.npmrc
```

副作用の見立て。

prefix 配下の `lib/node_modules` は空だったので、削除しても見えなくなる npm-global パッケージはなかった。今後 `npm install -g` で何か入れると Homebrew や Node 同梱の既定 prefix に入る。`~/.local/bin` を意図的に npm-global として使いたい場合のみ別ディレクトリに変更する。

## 教訓

claude doctor が誤検知を出すとき、claude 側のファイルだけ見ても直らない。`~/.npmrc` の prefix が native install のパスと同じだと衝突する。native installer は `~/.local/bin` に symlink を置く前提なので、npm の prefix も同じディレクトリに設定していると共存できない。

`~/.claude/.last-update-result.json` は update 試行の最後の結果を記録するキャッシュで、`path` フィールドが doctor の表示に影響する。古い記録が残っていると過去の状態を引きずる。

ついでに掃除できるもの。

`~/.local/share/claude/versions/` には旧バージョンのバイナリが残ることがある（今回は 2.1.161 と 2.1.165 で計 420MB）。symlink が指していない版は削除して良い。

`~/.npm/_npx/<hash>/` の `@anthropic-ai/claude-code` は npx 経由で過去に使った残骸。再生成されるので削除可。

## claude doctor は Claude から実行しない

`claude doctor` は出力後に `Enter to continue · f to fix with Claude` の対話プロンプトに入り、明示的な入力がないと終了しない。Bash 経由で実行するとそのままハングするので、Claude が自動実行するコマンドとして使ってはいけない。ユーザーに実行してもらい、出力結果を貼り付けてもらう運用にする。

