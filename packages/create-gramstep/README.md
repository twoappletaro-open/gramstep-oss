# create-gramstep

GramStep を Cloudflare にセットアップするための CLI です。

## Usage

```bash
npx create-gramstep@latest
```

このコマンドは、GramStep リポジトリ外で実行された場合にソースを自動取得します。

- カレントディレクトリが空ならその場に clone
- すでにファイルがある場合は `./gramstep` に clone

clone 後は自動で `pnpm install` を実行してセットアップを開始します。

明示的にコマンドを書く場合:

```bash
npx create-gramstep@latest setup
npx create-gramstep@latest setup --fresh
npx create-gramstep@latest redeploy
```

## Requirements

- Node.js 20+
- pnpm 10+
- Git
- Cloudflare account
- Meta Developer account

## Repository

- OSS repo: `https://github.com/twoappletaro-open/gramstep-oss`
- Docs: `https://twoappletaro-open.github.io/gramstep-oss/`
