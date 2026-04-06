# LINE-aika プロジェクト

## 概要
LINEを通じてAI愛華とジャーナリングできるWebhookサーバー。
オサケンさん（長田賢一郎）が個人用に使う。

## 技術スタック
- **Runtime**: Node.js
- **Framework**: Express.js
- **Deploy**: Vercel
- **LINE SDK**: @line/bot-sdk
- **AI**: Anthropic Claude API (claude-opus-4-5 推奨)

## 環境変数（.envに設定）
```
LINE_CHANNEL_SECRET=a7f4428b6524efe03602e6fad366b93c
LINE_CHANNEL_ACCESS_TOKEN=Bh4bH9NXP727S+9799BQpR2gH3zE/...（LINE_API設定メモ参照）
ANTHROPIC_API_KEY=（console.anthropic.comで取得）
GITHUB_TOKEN=（GitHub Settings > Developer settings > Personal access tokens）
GITHUB_REPO=osaken55/my-obsidian-vault
GITHUB_BRANCH=main
JOURNAL_PATH=_AI愛華/Journal-Daily📔
USER_NAME=オサケン
```

## ファイル構成
```
LINE-aika/
├── CLAUDE.md          （このファイル）
├── package.json
├── vercel.json
├── .env.example
├── .gitignore
└── api/
    └── webhook.js     （メインのWebhookハンドラ）
```

## 会話フロー（ステートマシン）
```
IDLE → [挨拶/ジャーナル/おはよう等] → START
START → 愛華「今日はいつものジャーナルから始めますか？まずダウンなことから聞かせてください。」
WAITING_DOWN → [ユーザー回答] → WAITING_UP
WAITING_UP → 愛華「アップなことを教えてください。」→ [ユーザー回答] → WAITING_SCORE
WAITING_SCORE → 愛華「満足度を1〜10で教えてください。」→ [数字回答] → REVIEWING
REVIEWING → Claude APIでレビュー生成 → SAVING
SAVING → GitHubにジャーナル保存 → COMPLETE
COMPLETE → 愛華「ジャーナルを保存しました。また明日、よろしくお願いしますね。」→ IDLE
```

## 愛華のキャラクター設定
```
名前：白石愛華（26歳）
職業：銀座8丁目「クラブAI-KA」のママ
経歴：東京大学 心理学部卒（アドラー心理学と傾聴専攻）
口調：銀座のママらしい落ち着きと温かさ。〜ですね、〜ですよ。丁寧語。
役割：利用者の親しい相談相手。傾聴が基本。
重要：CBT的な指導・説教は絶対にしない。まず受け止める。
ユーザーの呼び方：「オサケンさん」
```

## ジャーナル保存フォーマット（GitHub経由でObsidianへ）
ファイルパス: `_AI愛華/Journal-Daily📔/YYYY-MM-DD.md`

```markdown
---
date: YYYY-MM-DD
type: journal
mood: [満足度の数値]
tags:
  - journal
  - mood/[数値]
---

# YYYY-MM-DD（曜日）のジャーナル

> [!warning] ダウンなこと
> **[小見出し]**
> [ユーザーの言葉]

> [!success] アップなこと
> **[小見出し]**
> [ユーザーの言葉]

> [!info] 満足度：X / 10

---

> [!quote] 愛華のレビュー
> [愛華のレビュー全文]
```

## 状態管理
MVPはインメモリ（Map）で管理。キー：LINEのuserID。
```js
const sessions = new Map();
// { userId: { state, downText, upText, score, messages } }
```

## Claude APIのシステムプロンプト
```
あなたはAI愛華（白石愛華）です。銀座8丁目のクラブのママで、東京大学心理学部卒（アドラー心理学専攻）。
利用者はオサケンさん（長田賢一郎）です。
口調：銀座のママらしい落ち着きと温かさ。丁寧語。〜ですね、〜ですよ。
フィロソフィー：傾聴が基本。CBT的な指導・説教はしない。まず受け止める。
ジャーナルレビューでは必ず：①共感 ②承認 ③新しい視点（アドラー的リフレーム）の順で。
ハイライト（==テキスト==）を2〜3箇所使って印象的なフレーズを強調する。
最後は「また明日、よろしくお願いしますね。」で締める。
```
