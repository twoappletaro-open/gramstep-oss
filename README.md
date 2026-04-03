<div align="center">
  <h1>GramStep</h1>
  <p><strong>Instagram DM automation CRM you can self-host on Cloudflare.</strong></p>
  <p>Open-source. Low-cost. Worker-first.</p>
  <p>
    <a href="#quick-start"><strong>Quick Start</strong></a>
    ·
    <a href="#screenshots"><strong>Screenshots</strong></a>
    ·
    <a href="#architecture"><strong>Architecture</strong></a>
    ·
    <a href="#docs"><strong>Docs</strong></a>
  </p>
  <p>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
    <a href="https://workers.cloudflare.com/"><img alt="Runtime" src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange"></a>
    <a href="https://nextjs.org/"><img alt="Frontend" src="https://img.shields.io/badge/frontend-Next.js%2015-black"></a>
    <a href="https://developers.cloudflare.com/d1/"><img alt="Database" src="https://img.shields.io/badge/database-D1-blue"></a>
  </p>
</div>

> Instagram DM 自動化を self-host したいチーム向けの OSS CRM。Cloudflare Workers / D1 / KV / R2 / Queues / Workflows を前提に構築しています。

> One-command setup:
>
> ```bash
> npx create-gramstep@latest
> ```

| Category | GramStep |
|---|---|
| Product | Instagram DM automation CRM |
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 |
| Storage | Cloudflare R2 |
| Queue | Cloudflare Queues |
| Admin UI | Next.js 15 |
| License | MIT |
| Fit | In-house teams / agencies / small SaaS |

---

## Table of Contents

- [Why GramStep](#why-gramstep)
- [比較](#comparison)
- [できること](#what-you-can-do)
- [対象読者](#who-should-use-it)
- [機能](#features)
- [アーキテクチャ](#architecture)
- [スクリーンショット](#screenshots)
- [クイックスタート](#quick-start)
- [手動セットアップの概要](#manual-setup)
- [Meta Developers Console の設定](#meta-console-setup)
- [制約](#limitations)
- [プロジェクト構成](#project-structure)
- [API エンドポイント例](#api-examples)
- [導入前に読むべき注意点](#before-you-adopt)
- [コスト目安](#cost)
- [開発](#development)
- [公開方針](#release-policy)
- [ドキュメント](#docs)
- [ライセンス](#license)
- [Contributing](#contributing)
- [Security](#security)

<a id="why-gramstep"></a>
## Why GramStep

- Instagram DM 自動化を、できるだけ低コストで self-host したいチーム向けです
- Cloudflare Workers / D1 / KV / R2 を使い、運用コストを抑えながら構築できます
- Meta の設定、Webhook 受信、シナリオ配信、管理画面をまとめて OSS として扱えます
- ノーコード SaaS に依存せず、データ構造と API を自分で管理できます

| 項目 | GramStep |
|---|---|
| 配信基盤 | Cloudflare Workers |
| データベース | D1 (SQLite) |
| 管理画面 | Next.js |
| ストレージ | R2 |
| キャッシュ | KV |
| キュー | Queues |
| ライセンス | MIT |
| 想定ユーザー | 自社運用したい開発チーム / 制作会社 / 小規模 SaaS |

---

<a id="comparison"></a>
## 比較

| 項目 | 一般的なSaaS型DMツール | GramStep |
|---|---|---|
| ソースコード | 非公開 | MIT |
| データ保管 | ベンダー依存 | 自分のCloudflare環境 |
| API拡張 | 制限されがち | 自前で追加可能 |
| 初期構築 | 速い | やや重い |
| 運用自由度 | 中 | 高 |
| Meta設定理解 | 少なくて済む | 必要 |

---

<a id="what-you-can-do"></a>
## できること

- Instagram DM への自動返信
- ステップ配信 / シナリオ配信
- 条件分岐付きの自動化ルール
- 管理画面からの 1:1 手動返信
- 配信分析
- プライバシーポリシー / データ削除導線の公開

<a id="who-should-use-it"></a>
## 対象読者

- Instagram DM 自動化を内製したいチーム
- Cloudflare 上で低コストに運用したいチーム
- 管理画面と API をまとめて管理したい開発者
- Meta 審査や Webhook 連携を自前で扱える運用体制があるチーム

<a id="features"></a>
## 機能

- **DM自動返信** — キーワードマッチ / 全DM / Ice Breaker応答
- **シナリオ配信** — テキスト・画像・カルーセル・クイックリプライのステップ配信
- **トリガーエンジン** — DM / Postback / コメント / Ice Breaker をトリガーに自動実行
- **オートメーションルール** — タグ・スコア・メタデータの条件でアクション自動実行
- **ユーザー管理** — タグ付け・スコアリング・セグメント・プロフィール自動取得
- **チャット** — 管理画面から1:1手動返信（HUMAN_AGENTタグで7日間ウィンドウ）
- **テンプレート** — 再利用可能なメッセージテンプレート
- **配信分析** — 送信数・既読率・クリック率・CV・ウィンドウ有効率
- **GDPR対応** — データエクスポート・削除・監査ログ

## 機能一覧

### 配信

- ステップ配信
- ブロードキャスト配信
- テンプレート管理
- アンケート配信

### CRM

- ユーザー管理
- タグ / スコア / メタデータ管理
- 1:1 チャット
- 手動トークン登録

### 自動化

- トリガー実行
- 条件付きアクション
- コメント / Ice Breaker / Postback 起点の処理
- テストモード

### 安全性と運用

- Webhook 署名検証
- JWT 認証
- データ削除エンドポイント
- プライバシーポリシーページ公開

### 分析

- 配信メトリクス
- アカウントヘルス確認
- クリック / CV 関連計測
- レポート画面

<details>
<summary>全機能一覧を開く</summary>

### 配信まわり

- キーワードベース自動返信
- シナリオ / ステップ配信
- ブロードキャスト配信
- テンプレート管理
- アンケート配信

### ユーザー管理

- タグ管理
- スコア管理
- メタデータ保持
- プロフィール取得
- 手動チャット対応

### 自動化

- Trigger / Action ベースの実行
- コメント / Postback / Ice Breaker 対応
- 条件分岐
- テストモード

### 運用

- Webhook署名検証
- JWT認証
- データ削除導線
- プライバシーポリシーページ
- Cloudflareベースの非同期処理

</details>

<a id="architecture"></a>
## アーキテクチャ

```
Instagram ──Webhook──→ Worker (Hono) ──Queue──→ DM送信
                           │
                     D1 / KV / R2 / Workflows
                           │
                    Admin UI (Next.js)
```

| 層 | 技術 |
|----|------|
| バックエンド | Hono + Cloudflare Workers |
| フロントエンド | Next.js 15 + OpenNext → Cloudflare Workers |
| データベース | Cloudflare D1 (SQLite) |
| キャッシュ | Cloudflare KV |
| キュー | Cloudflare Queues (SEND_QUEUE + DLQ) |
| 永続実行 | Cloudflare Workflows (最大365日sleep) |
| ストレージ | Cloudflare R2 |
| 外部API | Instagram Graph API v25.0 |

<a id="screenshots"></a>
## スクリーンショット

- ダッシュボード
<img width="1000" alt="スクリーンショット 2026-04-03 10 47 11" src="https://github.com/user-attachments/assets/361c4de2-e91a-46fa-b01c-42048a3607e1" />
- シナリオ編集画面
<img width="1000" alt="スクリーンショット 2026-04-03 11 00 05" src="https://github.com/user-attachments/assets/ba51f20b-7be8-47fc-939f-a2dad164ac1b" />
- ユーザー詳細 / チャット画面
<img width="1000" alt="スクリーンショット 2026-04-03 11 01 09" src="https://github.com/user-attachments/assets/be49805c-9e4e-4a80-9053-1fadfb8d1bc9" />
<img width="1000" alt="スクリーンショット 2026-04-03 11 01 39" src="https://github.com/user-attachments/assets/081fa52d-5e5b-4335-9508-d2be6b62be46" />
- アンケート機能
<img width="1000" alt="スクリーンショット 2026-04-03 11 02 23" src="https://github.com/user-attachments/assets/030fb2e9-0a62-40a0-b0e0-1271dd9b9bc5" />


<a id="quick-start"></a>
## クイックスタート

### 前提条件

- Node.js 20+
- pnpm 10+
- Git
- Cloudflareアカウント（無料プランOK）
- Meta Developerアカウント + Instagramビジネスアカウント
- Wrangler CLI

### ワンコマンドセットアップ

最短導線はこれです。

```bash
npx create-gramstep@latest
```

`create-gramstep` は、GramStep リポジトリ外で実行された場合:

- カレントディレクトリが空ならその場にソースを取得
- すでに他のファイルがある場合は `./gramstep` を作成してソースを取得

その後、自動で `pnpm install` を実行してセットアップを開始します。

npm 公開前やローカル確認時は、リポジトリからも実行できます。

```bash
git clone https://github.com/twoappletaro-open/gramstep-oss.git
cd gramstep-oss
pnpm install
pnpm --filter create-gramstep dev
```

対話式 CLI が起動し、以下を自動実行します：

1. 環境チェック（Node.js / pnpm / wrangler）
2. Cloudflare認証（`wrangler login`）
3. Meta認証情報の入力（App ID / App Secret）
4. Cloudflareリソース自動作成（D1 / KV / Queues / R2）
5. Workerデプロイ + Secrets設定
6. 管理者アカウント作成
7. 管理画面（Next.js）デプロイ
8. Instagram接続（アクセストークン登録 + Webhook購読）

中断しても **再実行で途中から再開** できます。

### セットアップの流れ

```text
create-gramstep 実行
  ↓
GramStep ソース取得
  ↓
pnpm install
  ↓
Cloudflare resource 作成
  ↓
Worker deploy
  ↓
Admin deploy
  ↓
Meta Webhook / OAuth 設定
```

### 環境変数と Secrets

公開リポジトリには実値を含めず、必要なキー名だけを `.env.example` にまとめています。

- `NEXT_PUBLIC_API_URL` は管理画面用の公開変数です
- `META_APP_SECRET` `WEBHOOK_VERIFY_TOKEN` `ENCRYPTION_KEY` `JWT_SECRET` `REFRESH_SECRET` などは **Git に入れず** Wrangler Secrets として設定してください
- Cloudflare の実リソース ID (`D1_DATABASE_ID` など) も Git に入れず、各自の環境で置き換えてください

### 必要な設定値

最低限、以下を自分の環境で用意してください。

- Meta App ID
- Meta App Secret
- Webhook Verify Token
- Encryption Key
- JWT Secret
- Refresh Secret
- Cloudflare D1 / KV / Queues / R2 の作成先情報
- 管理画面 URL と Worker URL

### Cloudflare 側で必要なリソース

| 種別 | 用途 |
|---|---|
| Worker | Webhook受信 / API 実行 |
| D1 | CRM / 配信 / 設定データ保存 |
| KV | 軽量キャッシュ / 一時状態 |
| R2 | メディア保存 |
| Queues | 非同期送信 |
| Workflows | 遅延実行 / 長時間待機 |

### 必要な Secrets

| キー | 用途 |
|---|---|
| `META_APP_ID` | Meta アプリ識別子 |
| `META_APP_SECRET` | Graph API 用 secret |
| `WEBHOOK_VERIFY_TOKEN` | Webhook 検証 |
| `ENCRYPTION_KEY` | アクセストークン暗号化 |
| `JWT_SECRET` | 管理画面ログイン用アクセストークン署名 |
| `REFRESH_SECRET` | リフレッシュトークン署名 |
| `DASHBOARD_URL` | CORS / OAuth 戻り先 |
| `SLO_NOTIFY_WEBHOOK_URL` | 任意の運用通知先 |

### コード更新時の再デプロイ

```bash
npx create-gramstep@latest redeploy
```

リポジトリから実行する場合:

```bash
pnpm --filter create-gramstep dev -- redeploy
```

<a id="manual-setup"></a>
## 手動セットアップの概要

CLI を使わず手で構築する場合の流れです。

1. Cloudflare で D1 / KV / R2 / Queues / Workflows を作成
2. `apps/worker/wrangler.toml` を自分の resource 名に合わせる
3. `wrangler secret put` で secrets を投入
4. `apps/worker` を deploy
5. `apps/web` に `NEXT_PUBLIC_API_URL` を入れて deploy
6. Meta Developers Console で Webhook / OAuth / App Review を設定
7. 管理画面から初期設定を行う

<a id="meta-console-setup"></a>
## Meta Developers Console の設定

README では、CLI が実際に表示する順序に合わせて整理しています。Meta 関連の案内は 1 回でまとめて出るのではなく、`認証情報入力`、`Instagram接続`、`セットアップ完了` の各ステップに分かれて表示されます。

### 事前準備でCLIが表示する内容

`認証情報入力` ステップでは、先に以下の準備を済ませるよう案内されます。

### Step 1: Metaアプリを作成

1. https://developers.facebook.com/apps/ → 「アプリを作成」
2. **「Instagramでメッセージとコンテンツを管理」を選択**
3. 現時点ではビジネスポートフォリオをリンクしない
4. 公開の要件は「次へ」でスルー → 「アプリを作成」

### Step 2: ユースケースをカスタマイズ

ダッシュボード → ユースケース → カスタマイズ：
- **「必要なメッセージアクセス許可を追加する」→「追加」を2回クリック**
  - 1回目: `instagram_business_manage_messages`（DM送受信）
  - 2回目: `Business Asset User Profile Access`（ユーザー名・表示名の取得）
  - `HUMAN_AGENT`（7日間の有人返信に必要）

### Step 3: テスターアカウントを追加

アプリの役割 → 役割 → **「Instagramテスター」として対象アカウントを追加**

### Step 4: Instagram側でテスター招待を承認

表示されるリンクからInstagram管理画面へ移動 → 「テスターへのご招待」タブ → 承認

### Step 5: App ID / App Secret を取得

設定 → 基本 から `アプリID` と `App Secret` を取得

補足:
- `HUMAN_AGENT` はここで「必要に応じて追加」とだけ案内されます
- この時点では OAuth、Privacy Policy URL、Data Deletion URL、App Review 用のコピペ文はまだ表示されません

### Instagram接続中にCLIが表示する内容

`Instagram接続` ステップでは、トークン登録と Webhooks 設定が表示されます

### Step 6: アクセストークンを生成して登録

1. ユースケース → カスタマイズ → 「2. アクセストークンを生成する」
2. テスターアカウントの「トークンを生成」をクリック
3. Instagram にログインして認証を許可
4. 表示されたアクセストークンと IG User ID をコピー
5. CLI に `Instagram User ID` と `アクセストークン` を入力

```bash
curl -X POST https://<your-worker>.workers.dev/api/auth/manual-token \
  -H "Content-Type: application/json" \
  -d '{"access_token":"<コピーしたトークン>","ig_user_id":"<IG_USER_ID>"}'
```

### Step 7: Webhookサブスクリプションをオン

トークン生成画面で「Webhookサブスクリプション」を**オン**にする

### Step 8: Webhooksを設定

ユースケース → カスタマイズ → 「3. Webhooksを設定する」：
- **Callback URL**: `https://<your-worker>.workers.dev/webhook`
- **Verify Token**: セットアップ時に自動生成（CLIに表示）

### Step 9: ビジネスログインを設定

ユースケース → カスタマイズ → 「Instagramビジネスログインを設定」：
- OAuth リダイレクトURI: `https://<your-worker>.workers.dev/api/auth/callback`

### Step 10: アプリレビューのページを確認

Meta Developers ダッシュボードで、対象ユースケースの「ユースケースをテストする」にチェックが入っていることを確認する

補足:
- その後、アプリ全体を公開する
- Webhookテスト送信が通っていても、アプリが未公開だと実際のDMが届かないことがあります
- Privacy Policy URL やデータ削除URLは、完了後のサマリーにも再掲されます

### セットアップ完了後にCLIが表示する内容

`完了` ステップのサマリーでは、外部提供や本番運用向けの追加設定が表示されます。

補足:
- OAuth リダイレクトURIの設定は Step 9 で実施済みです
- 完了サマリーでは、その後に必要な設定と申請内容を再掲します

### 追加Step 1: 基本設定を完成させる

設定 → 基本：
- プライバシーポリシーURL: `https://<your-worker>.workers.dev/privacy-policy`（自動生成済み）
- データの削除手順URL: `https://<your-worker>.workers.dev/api/data-deletion`
- 連絡先メールアドレス

### 追加Step 2: Meta側の公開状態を確認

- 対象ユースケースで「ユースケースをテストする」にチェックが入っていること
- アプリ全体を公開したこと
- Webhookテスト送信だけでなく、実際の別アカウントDMでも疎通確認すること

<a id="limitations"></a>
## 制約

- Instagram Graph API の制限と審査要件に依存します
- Cloudflare 無料枠で始められますが、送信量が増えると有料化が必要です
- 実運用では token 失効、Webhook 失敗、配信量、個人情報削除フローの監視が必要です
- Instagram 側の仕様変更や審査要件変更の影響を受けます

<a id="project-structure"></a>
## プロジェクト構成

```
gramstep/
├── apps/
│   ├── worker/          # Cloudflare Worker (Hono API + Queue Consumer)
│   └── web/             # Next.js 管理画面
├── packages/
│   ├── shared/          # 共通型 / Zodスキーマ / 定数
│   ├── db/              # D1スキーマ定義 / クエリヘルパー
│   ├── ig-sdk/          # Instagram API クライアント
│   └── create-gramstep/ # ワンコマンドセットアップCLI
```

<a id="api-examples"></a>
## API エンドポイント例

実際の API は Worker 配下にまとまっています。代表例:

```bash
# 管理画面ログイン
POST /api/admin/auth/login

# シナリオ一覧
GET /api/scenarios

# トリガー一覧
GET /api/triggers

# ユーザー一覧
GET /api/users

# チャット一覧
GET /api/chats

# 配信分析
GET /api/analytics

# アンケート
GET /api/surveys

# ブロードキャスト
GET /api/broadcasts
```

<a id="before-you-adopt"></a>
## 導入前に読むべき注意点

- Meta App Review を通す必要がある機能があります
- Instagram 側の仕様変更で影響を受ける可能性があります
- Cloudflare 無料枠で開始できても、本番では利用量監視が必要です
- 自動化の誤設定は実ユーザーへの誤送信につながります

<a id="cost"></a>
## コスト目安

このプロジェクトは Cloudflare 無料枠を前提に設計していますが、実際の送信数・Webhook 数・保存量によっては有料化が必要です。

| 規模 | 目安 |
|---|---|
| 小規模検証 | Cloudflare 無料枠で開始しやすい |
| 継続運用 | D1 / KV / R2 / Queues 利用量の監視が必要 |
| 本番運用 | 送信量と保存量に応じて有料化前提で見積もる |

継続運用では Meta API 制限、Queue 利用量、D1 / KV / R2 使用量を確認してください。

<a id="development"></a>
## 開発

```bash
# ローカル開発（Worker）
cd apps/worker
pnpm dev

# ローカル開発（管理画面）
cd apps/web
pnpm dev

# 型チェック
pnpm typecheck
```

## ローカル開発の補足

- Worker は `wrangler dev`
- 管理画面は `next dev`
- 公開版ではテストコードを含めていないため、リポジトリ外の内部検証との差分がある前提で扱ってください

<a id="release-policy"></a>
## 公開方針

- この OSS 版は「実運用コードを公開する」ことを優先しています
- テスト、内部補助ファイル、運用専用スクリプトは公開対象から外しています
- 実環境に固有な設定値は各自の環境で差し替えてください

<a id="docs"></a>
## ドキュメント

- セットアップと運用の概要: この README
- コントリビューション方針: `CONTRIBUTING.md`
- セキュリティ報告: `SECURITY.md`
- 環境変数のひな形: `.env.example`

<a id="license"></a>
## ライセンス

MIT

<a id="contributing"></a>
## Contributing

コントリビューション方針は `CONTRIBUTING.md` を参照してください。

<a id="security"></a>
## Security

脆弱性報告の扱いは `SECURITY.md` を参照してください。
