# Antigravity への指示書
## LINE 愛華ジャーナリングBot 実装タスク

---

## 概要

LINEを通じてAI愛華とジャーナリングできるWebhookサーバーを作ってください。
このフォルダのCLAUDE.mdを必ず最初に読んでから実装してください。

---

## 作成するもの

以下のファイルを実装してください：

### 1. `package.json`
依存パッケージ：
- `@line/bot-sdk` - LINE Messaging API
- `@anthropic-ai/sdk` - Claude API
- `express` - Webサーバー
- `dotenv` - 環境変数

### 2. `api/webhook.js`
Vercel用のServerless Functionとして実装。
以下の機能を含む：

**a) LINEのWebhook検証**
- LINE_CHANNEL_SECRETでシグネチャ検証

**b) メッセージ受信・返信**
- ユーザーのテキストメッセージを受け取る
- 会話ステート（IDLE/WAITING_DOWN/WAITING_UP/WAITING_SCORE/REVIEWING）を管理
- Claude APIを使って愛華のレスポンスを生成
- LINEに返信

**c) ジャーナル保存（REVIEWING完了時）**
- GitHub APIを使って `_AI愛華/Journal-Daily📔/YYYY-MM-DD.md` にpush
- CLAUDE.mdに記載のフォーマットで保存

### 3. `vercel.json`
```json
{
  "rewrites": [
    { "source": "/webhook", "destination": "/api/webhook" }
  ]
}
```

### 4. `.gitignore`
`.env` を含める

---

## 会話ステート詳細

```
IDLE:
  トリガー: 「こんにちは」「おはよう」「こんばんは」「ジャーナル」「愛華」
  愛華の返答: 「オサケンさん、こんにちは。今日のジャーナル、聞かせてください。まずダウンなことから教えてもらえますか？」
  次のステート: WAITING_DOWN

WAITING_DOWN:
  ユーザーの入力をdownTextとして保存
  愛華の返答: 「受け取りました。次に、アップなことを教えてください。」
  次のステート: WAITING_UP

WAITING_UP:
  ユーザーの入力をupTextとして保存
  愛華の返答: 「ありがとうございます。最後に、今日の満足度を1〜10で教えてください。」
  次のステート: WAITING_SCORE

WAITING_SCORE:
  1〜10の数字を受け取り、scoreとして保存
  Claude APIでレビューを生成（CLAUDE.mdのシステムプロンプト使用）
  愛華のレビューをLINEに送信
  GitHubにジャーナルを保存
  愛華の返答: 「ジャーナルを保存しました。また明日、よろしくお願いしますね。」
  次のステート: IDLE
```

---

## 環境変数

`.env.example` を参照。`.env` を作成して値を設定してください。

---

## 実装完了後にやること

1. `npm install` で依存パッケージをインストール
2. `.env` に環境変数を設定
3. ローカルテスト: `node api/webhook.js` で起動確認
4. Vercelデプロイ: `vercel deploy`
5. 取得したVercel URLを `https://your-app.vercel.app/webhook` 形式でLINEのWebhook URLに設定

---

## 注意事項

- LINEのメッセージは1回のリクエストで複数届く場合がある（`events`配列）
- Vercelはサーバーレスなのでインメモリのstateはコールドスタート時にリセットされる（MVP段階はOK）
- エラーハンドリングを必ず入れる（特にClaude API呼び出し）
- レスポンスは1000ms以内に返す必要がある（Claude APIの呼び出しは非同期で別処理に）
