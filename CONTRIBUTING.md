# Contributing

GramStep へのコントリビュートを歓迎します。大きな変更の前に、まず Issue で方針を共有してください。

## 対象

- バグ修正
- ドキュメント改善
- セットアップ改善
- UI/UX 改善
- Cloudflare / Meta まわりの運用改善

## 進め方

1. Issue を確認し、重複がないか調べる
2. 必要なら Issue を立てて変更方針を共有する
3. フォークしてブランチを切る
4. 変更内容を小さく保つ
5. Pull Request を作る

## Pull Request の方針

- 1つの PR では 1つの目的に絞ってください
- README やセットアップ導線に影響する変更は、説明も更新してください
- Secrets や実運用 URL、Cloudflare の実 ID を含めないでください
- 破壊的変更は PR 説明に明記してください

## 開発メモ

- 管理画面は `apps/web`
- Worker/API は `apps/worker`
- 共通型は `packages/shared`
- セットアップ CLI は `packages/create-gramstep`

## セキュリティ

脆弱性報告は公開 Issue ではなく、まず `SECURITY.md` の手順に従ってください。
