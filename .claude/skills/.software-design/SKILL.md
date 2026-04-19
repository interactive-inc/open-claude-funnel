---
name: software-design
description: Software design skill covering product thinking (JTBD, UX 5 planes) and code design (Simple Design, patterns). Reference before any design decision. Reviews are done by the software-designer agent.
---

# 製品設計

.docs/ がある場合のみ適用。UX 5段階モデル（戦略→要件→構造→骨格→表層）で今どの段階の議論か意識する。顧客理解は `.docs/index.md` に記録。

- JTBD: 機能の前に「顧客が雇うジョブ」を特定する
- 画面順: 操作順でなく、不安を解消する順に並べる
- シナリオ: 「クリックする」でなく「迷う／安心する」を書く

## UI 構造（OOUI）

- 名詞→動詞: 対象を選んでから操作を選ぶ。タスク（動詞）起点で組まない
- メニュー項目は名詞で書く（「登録する」でなく「利用者」）
- オブジェクトごとに一覧ビューと詳細ビューを用意する
- モードレス: 線形フロー強制禁止、複数経路で到達できるようにする
- 構造はタスクでなくオブジェクトで作る（タスクは変わる、オブジェクトは残る）

# コード設計

Simple Design（Kent Beck）の4ルールに帰着：テストが通る → 意図が明確 → 重複がない → 最小の要素。

## 型の誠実さ

- `as unknown as T` や `any` を使いたくなったら、それは設計の歪みのサイン
- 回避策で逃げず、根本原因（型の不整合・責務の重複・境界の引き方）を直す
- 型は嘘をつかない。安全性を犠牲にして進めるより、構造を見直す

## 構造の選択

- 入力→出力だけ ⇒ 関数
- 設定を保持し複数操作で共有（APIクライアント、DB接続）⇒ クラス
- バリデーション付きの値 ⇒ Value Object（Zod + Object.freeze）
- 不変データの集まり・ロジック不要 ⇒ type
- 引数4超 ⇒ Builder またはオブジェクト引数

## レイヤー分離

段階導入。判断軸は「モックなしでテストできるか」。できないなら分離。

- 単純な CRUD ⇒ 直接実装、層を分けない
- 複数処理が関連 or 2箇所以上で同じロジック ⇒ Service 層
- 複雑なビジネスルール or 不変条件の保証 ⇒ Domain 層
- DI はコンストラクタ注入のみ、コンテナ禁止
- DI が要るのは外部依存のあるクラスのみ、純粋計算には不要

詳細 ⇒ [architecture.md](references/architecture.md)

## パターン選択

- 変換チェーン ⇒ [Fluent API](references/fluent-api.md)
- 複数リソース調整（3つ以上）⇒ [Service Layer](references/service-layer.md)
- API 簡略化 ⇒ Facade
- 状態遷移 ⇒ [FSM](references/fsm.md)
- 型レベルの状態区別・単位混同防止・バリデーション前後 ⇒ [Phantom Type](references/phantom-type.md)
- 生成パターンが複数 ⇒ Factory Method
- 外部インターフェース変換 ⇒ Adapter
- UI 非同期状態（ブラウザ／CLI）⇒ [Reducer](references/reducer.md)（バックエンド禁止）
- データアクセス抽象化 ⇒ Repository
- 型安全な値 ⇒ [Value Object](references/value-object.md)

## Implementation Patterns 読み替え

Kent Beck の Implementation Patterns を TypeScript に読み替える。

- クラス継承 ⇒ Union 型 + exhaustive switch
- インターフェース ⇒ type + 関数
- Method Object ⇒ クロージャ or オブジェクト引数
- Collection wrapper ⇒ ReadonlyArray + ユーティリティ関数

## リファレンス

- UX 5段階 ⇒ [ux-five-planes.md](references/ux-five-planes.md)
- エラーハンドリング ⇒ [error-handling.md](references/error-handling.md)
- React ⇒ [react.md](references/react.md)
