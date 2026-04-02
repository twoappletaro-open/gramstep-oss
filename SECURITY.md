# Security Policy

## Supported Versions

公開後しばらくは `main` ブランチをベースにメンテナンスします。

## Reporting a Vulnerability

脆弱性の可能性がある内容は、公開 Issue に書かないでください。

報告時には以下を含めてください。

- 対象機能
- 影響範囲
- 再現手順
- 想定される悪用方法
- 可能なら修正案

機密情報、トークン、Webhook secret、個人情報はそのまま送らないでください。必要な箇所はマスクしてください。

## 対象になりやすい領域

- 認証 / 認可
- Webhook 署名検証
- Secret 管理
- Cloudflare Worker / KV / D1 / R2 の設定不備
- 個人情報削除や GDPR 関連の不備

## 公開前の注意

以下は Git に commit しないでください。

- `.env`
- `.dev.vars`
- 実運用の Cloudflare resource ID
- 実運用トークン
- 実運用の Webhook verify token
- JWT / refresh / encryption secrets
