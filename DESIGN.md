---
version: alpha
name: Funnel TUI
description: OpenTUI ダッシュボード（fnl）のビジュアル規約
colors:
  bg: "#0a0a0a"
  surface: "#171717"
  elevated: "#262626"
  text: "#f5f5f5"
  text-bright: "#fafafa"
  dim: "#a3a3a3"
  faint: "#525252"
  primary: "#3b82f6"
  alive: "#86efac"
  dead: "#fca5a5"
  warn: "#fcd34d"
  primary-bg: "#fafafa"
  primary-hover-bg: "#d4d4d4"
  primary-pressed-bg: "#737373"
  primary-fg: "#0a0a0a"
  secondary-bg: "#737373"
  secondary-hover-bg: "#404040"
  secondary-pressed-bg: "#171717"
  secondary-fg: "#f5f5f5"
  button-disabled-bg: "#262626"
spacing:
  padding-x: 2px
  padding-y: 1px
  gap: 1px
  sidebar-width: 24px
  bar-height: 1px
  detail-panel-height: 14px
  modal-top: 4px
components:
  card:
    backgroundColor: "{colors.surface}"
  primary-button:
    backgroundColor: "{colors.primary-bg}"
    textColor: "{colors.primary-fg}"
  primary-button-hover:
    backgroundColor: "{colors.primary-hover-bg}"
  primary-button-pressed:
    backgroundColor: "{colors.primary-pressed-bg}"
  secondary-button:
    backgroundColor: "{colors.secondary-bg}"
    textColor: "{colors.secondary-fg}"
  secondary-button-hover:
    backgroundColor: "{colors.secondary-hover-bg}"
  secondary-button-pressed:
    backgroundColor: "{colors.secondary-pressed-bg}"
  button-disabled:
    backgroundColor: "{colors.button-disabled-bg}"
    textColor: "{colors.dim}"
  sidebar:
    backgroundColor: "{colors.surface}"
    width: "{spacing.sidebar-width}"
  main-view:
    backgroundColor: "{colors.bg}"
  detail-bar:
    backgroundColor: "{colors.elevated}"
    height: "{spacing.detail-panel-height}"
  selection-accent:
    backgroundColor: "{colors.primary}"
  text-default:
    textColor: "{colors.text}"
  text-bright:
    textColor: "{colors.text-bright}"
  text-faint:
    textColor: "{colors.faint}"
  status-alive:
    textColor: "{colors.alive}"
  status-dead:
    textColor: "{colors.dead}"
  status-warn:
    textColor: "{colors.warn}"
---

# DESIGN

funnel TUI のデザイン規約。コードでも遵守する。

## Overview

OpenTUI ベースのダッシュボード。情報密度を重視しつつ、線で囲わずに余白と階調だけで構造を伝える。Tailwind の neutral パレットをベースにし、状態色（alive / dead / warn）と Primary（blue）以外で別パレットを足さない。

トークンは lib/cli/tui/theme.ts に集約。コンポーネントは生のカラーを直接書かず、必ず theme.text / theme.dim / theme.alive などのセマンティック名を経由する。

## Colors

役割は背景階調、前景トーン、ステータスアクセントの 3 種に分かれる。

背景階調は深い → 浅いの順に 3 段：

- bg neutral-950 メインキャンバス専用。サイドバー内のサブ要素には使わない（main 側 bg と同色になり境界が混じる）
- surface neutral-900 サイドバー、Card、モーダル
- elevated neutral-800 サイドバー内のカード（gateway 状態）、detail バー、hover / select / active 行、editable label 半分

サイドバー内で「持ち上げる」階調は常に elevated。「沈み込ませる」階調は採用しない。

前景トーンは 4 段：

- text-bright neutral-50 entity 識別など強調
- text neutral-100 通常本文
- dim neutral-400 メタ情報、ヒント、見出しラベル
- faint neutral-600 無効化、省略

ステータスアクセントは alive / dead / warn の 3 色。Primary（blue-500）はインタラクション専用で、アクティブ行の左端 indicator と SelectionAccent の縦線にのみ使う。

## Typography

ターミナル等幅フォント前提。weight / size は変えられないので、強調は色（text-bright / dim）と大文字化、余白で表現する。

## Layout

線で囲まない。border プロパティは禁止。

セクション区切りはいずれかで表現する：

- 背景階調の差（bg / surface / elevated）
- 余白（padding-x / padding-y）
- 見出し（PanelHeader / SectionHeader の dim テキスト）
- Divider コンポーネント

数値の padding / width はコンポーネント側で直接書かない。padding-x / padding-y / gap / sidebar-width のセマンティックトークンのみを参照する。

トークン値の単位はターミナルセル（ターミナル UI なので px は存在しない）。spacing トークンに付いている px サフィックスは design.md フォーマットの Dimension 制約を満たすためのプレースホルダ。

padding-x / padding-y は UI 全体で統一（横 2 セル、縦 1 セル）。サイドバー、main、modal、行、footer すべてが同じ値を共有することで縦のベースラインが揃う。

メインビューは scrollbox で包む（ViewShell）。DetailBar も scrollbox を内包し、長い JSON も枠内でスクロールする。

## Elevation & Depth

階調は border ではなく背景色で表現する。bg → surface → elevated の 3 段だけで深度を構築する。

サイドバーのアクティブ行は左端に ▏（U+258F）を primary color で縦に並べる。border より細く読めるアクセント。bg は elevated、hover も同じ bg なので ▏ の有無だけが両者を区別する。

メインビューの選択（profiles / listeners の j/k カーソル）は Card の selected プロップで SelectionAccent（同じ ▏ の縦並び）を Card 左端にオーバーレイする。

## Components

積極的にコンポーネント化する。同じ JSX を 2 回以上書きそうになったら lib/cli/tui/components/ に切り出す。

ボタンは PrimaryButton と SecondaryButton の 2 種類。低レベルの Button 基底コンポーネントが状態管理（hover / pressed）を担い、各ラッパーが theme トークンで brand を bind する：

- PrimaryButton 白い CTA。primary-bg neutral-50 → hover で primary-hover-bg neutral-300 → pressed で primary-pressed-bg neutral-500（hover で暗くなる）。primary-fg neutral-950 を前景に
- SecondaryButton 暗めの muted ボタン（delete / cancel）。secondary-bg neutral-500 → hover neutral-700 → pressed neutral-900。danger プロップで前景を dead に切り替え（destructive アクション）

Disabled 共通：bg は button-disabled-bg neutral-800、fg は dim。compact プロップで padding-y を 0 にして 1 行高さ（delete のような副ボタン用）。

メインビューはエンティティ単位（connector / channel / profile / listener）で Card を並べる。ビュー全体を 1 枚の Card にしない：

- bg は常に surface、padding-x=2 / padding-y=1 / gap=1
- 上端に title テキスト（text-bright で entity 識別）
- selected プロップで SelectionAccent（▏）を左端にオーバーレイ
- onDelete プロップで右下に SecondaryButton（compact, danger）を自動配置

Card の中で並べるフィールドは EditableField（編集可能、左 elevated label / 右 bg input）または ReadonlyField（同じ split 形のラベル / 値）。

現存コンポーネント：

- Brand サイドバー上端のロゴ
- SectionHeader サイドバー内のセクションラベル
- MenuItem / Menu ナビゲーション行
- GatewayStatus ゲートウェイ状態カード（start / stop ボタン内蔵）
- SessionItem / SessionList 接続セッション一覧
- Button 低レベルボタン基底（公開しない）
- PrimaryButton / SecondaryButton 公開ボタン
- AddRow `+ ラベル` で PrimaryButton をラップ
- Card エンティティ単位の form ラッパ
- EditableField / ReadonlyField split-half の行
- SelectionAccent ▏ プライマリラインのオーバーレイ
- PanelHeader ビュー上端の見出し
- Divider 横線
- EmptyState プレースホルダ
- Keymap キーバインドのヒント
- ViewShell scrollbox で包んだビューシェル
- DetailBar 画面下端の scrollbox インスペクタ

## Do's and Don'ts

推奨：

- カラーは theme.ts のセマンティック名経由で参照する
- padding / width はトークン経由で参照する（生数値禁止）
- セクション区切りは余白、階調、見出し、Divider のいずれかで表現する
- サイドバー内の「持ち上げ」は elevated を使う
- 同じ JSX を 2 回書きそうになったら components/ に切り出す

禁止：

- border プロパティを使う
- 生 hex / Tailwind class をコンポーネントに直書きする
- neutral / status / primary 以外のパレットを足す
- ビュー全体を 1 枚の Card にする
- サイドバー内で bg（neutral-950）を使う
