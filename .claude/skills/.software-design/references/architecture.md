# 4層アーキテクチャ

小規模では不要。段階的に必要に応じて層を導入する。

## 4つの層

Interface → Application → Domain → Infrastructure

- Interface: HTTP リクエスト/レスポンス、認証、バリデーション
- Application: 複数ドメインオブジェクトの調整。1 Service = 1 ユースケース
- Domain: ビジネスルール、不変条件の保証。外部依存なし
- Infrastructure: DB アクセス、外部 API 通信。Adapter と Repository で隔離

## 各層のルール

### Interface 層

バリデーションと認証を行い、ビジネスロジックは Application 層に委譲する。エラーは `instanceof` で分岐してユーザー向けレスポンスに変換する。

### Application 層

Service クラスで実装。メソッド名は `execute` で統一。戻り値は `T | Error` で throw しない。
単純な CRUD は Service を経由しない。2つ以上の処理を組み合わせる場合のみ Service を作る。

### Domain 層

Entity はイミュータブル（Object.freeze）。状態変更は `with*()` で新しいインスタンスを返す。
Entity はフラットに保つ。他の Entity を入れ子にしない。関連データは JOIN してフラットに展開する。
集約ルートは守るべき不変条件ごとに分ける。

### Infrastructure 層

Repository は集約ルートごとに作成。メソッドは `findOne`, `findMany`, `write`, `delete` の4つに限定。
複雑な検索メソッドは作らない。検索条件は `where` 引数で表現する。
外部 API は Adapter で包む。

## エラーの流れ

Infrastructure(技術エラー) → Application(アプリエラーに変換) → Interface(ユーザー向けレスポンスに変換)

すべて `T | Error` で返す。throw しない。
