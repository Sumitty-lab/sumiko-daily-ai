# すみこ代理AI v0.1 クイックスタート

> LINE-aika に組み込まれた「すみこ代理AI」プラモデル版を、5分で動かす手順。

## 🎯 今回の追加内容

| ファイル | 内容 |
|---|---|
| `lib/sumiko.js` | すみこ代理のコアロジック（ペルソナ・状態管理・ログ保存） |
| `api/sumiko-cron.js` | Cronエンドポイント（朝/夕の自動Push） |
| `api/sumiko-cron-morning.js` | 朝Cron用ラッパ |
| `api/sumiko-cron-evening.js` | 夕Cron用ラッパ |
| `api/webhook.js` | （編集）「すみこ朝」等のコマンド検知＋すみこモード応答処理を追加 |
| `vercel.json` | （編集）Cron スケジュール追加 |
| `.env.example` | （編集）`SUMIKO_USERS` 等の環境変数追加 |

既存の愛華フローは ==一切壊していません==。

---

## 🚀 デプロイ手順（オサケンさん）

### 1. 自分の LINE userId を確認

ローカルで動作確認 or 既存のVercelデプロイ済みのままでOK。
LINE で 既存 line-aika Bot に **「すみこID」** と送信：

```
あなたのLINE userId:
Uxxxxxxxxxxxxxxxxxxxxx

この値を環境変数 SUMIKO_USERS に登録してください。
```

→ 表示された userId をコピー

### 2. Vercel 環境変数を追加

Vercel ダッシュボード（https://vercel.com/dashboard）でプロジェクト「LINE-aika」を開き、Settings → Environment Variables に追加：

```
SUMIKO_USERS = [{"lineUserId":"Uxxxxxxxxxxxxxxxxxxxxx","name":"オサケン","active":true}]
```

### 3. コードを GitHub に push

```bash
cd ~/Documents/Projects/osAKenAI/LINE-aika
git add -A
git commit -m "add: すみこ代理AI v0.1 (プラモデル版)"
git push origin main
```

→ Vercel が自動でデプロイ開始（1〜2分）

### 4. デプロイ完了後の動作確認

#### A. 手動テスト（即時）

LINEで line-aika Bot に：

```
すみこ朝
```

→ Botから「（テスト：すみこ朝のPushを送信しました...）」とリプライ
→ 続いて別メッセージで「すみこ代理です。今日はどんな予定が？」がPushで届く
→ 「銀行の記帳と請求書発行があります」と返信
→ AIが1問だけ問いかけてくれる
→ Vault `20_Projects/AllControlAI_すみこ代理AI/_logs/` にログが自動保存

#### B. Cron動作確認（手動トリガ）

```bash
curl 'https://line-aika.vercel.app/api/sumiko-cron?mode=morning&dry=1'
```

→ JSONで「wouldPushTo: ['オサケン']」が返れば設定OK

#### C. 自動Cron（明朝確認）

明朝 ==JST 8:00== に自動でPushが届くはず。
夕は ==JST 17:30==。

---

## 🛠️ ローカル開発

```bash
cd ~/Documents/Projects/osAKenAI/LINE-aika
npm install  # 既に済みなら不要
cp .env.example .env  # 値を埋める

# Webhookサーバー起動
node api/webhook.js
# → http://localhost:3000/webhook

# Cronエンドポイント手動テスト
node api/sumiko-cron.js
# → http://localhost:3001/api/sumiko-cron?mode=morning&dry=1
```

---

## 📁 v0.1 のデータフロー

```
[Cron 8:00 / 17:30] 
   ↓
[Vercel Function: sumiko-cron-morning/evening]
   ↓
[lib/sumiko.js: startMorningCheckin]
   ↓ 状態保存（GitHub: _state/{userId}.json）
   ↓ LINE Push「おはよう、今日はどんな予定？」
[ユーザー（社員）が LINE で返信]
   ↓
[Vercel Function: webhook]
   ↓ getState() で「すみこモード継続中」を検知
   ↓ Claude API で1問問いかけ生成
   ↓ LINE Reply
   ↓ ログ保存（GitHub: _logs/2026-04-XX_{userId}_morning.md）
   ↓ 状態クリア
[Obsidian Git で Vault に同期]
   ↓
[Obsidian で確認]
```

---

## 🐛 既知の制約（v0.1 プラモデル）

| 制約 | 妥協理由 | v0.2以降で解消 |
|---|---|---|
| 1往復で完結（マルチターンなし） | プラモデル原則：複雑にしない | KV / Postgresで本格的セッション管理 |
| 状態管理がGitHub（遅め） | 既存パターン流用で実装速い | Vercel KV |
| 社長コメント機能なし | v0.1 ではAIのみ | v0.4 で社長ダッシュボード |
| ペルソナ汎用版 | 素美子社長ペルソナは取材後 | ゆかさん主導の取材完了後 |
| 既存愛華Botと同居 | LINE Bot 新規作成のオーバーヘッド回避 | 必要に応じて分離 |

---

## 🚨 トラブルシューティング

### 「すみこ朝」と打ってもPushが来ない

1. `SUMIKO_USERS` 環境変数が正しく設定されているか確認
2. JSONが正しい形式か（`{"lineUserId":"...","name":"...","active":true}`）
3. Vercel logs を確認（Vercel Dashboard → Functions → Logs）

### Cron が発火しない

1. Vercel Hobby は1日1回×2cron まで。設定を確認
2. JST 8:00 / 17:30 は ==平日のみ== 起動（vercel.json で土日除外）
3. 明朝起きてみる

### 既存の愛華が動かなくなった

→ `git revert` でロールバック可能。すみこコードは全て既存ファイルの「追加部分」なので、`api/sumiko-*.js`, `lib/sumiko.js` を削除＋`webhook.js`を元に戻せばOK。

---

## 📚 関連ドキュメント

Vault側のプロジェクト設計書：
- `20_Projects/AllControlAI_すみこ代理AI/00_README.md`
- `20_Projects/AllControlAI_すみこ代理AI/01_システム設計書.md`
- `20_Projects/AllControlAI_すみこ代理AI/04_実装ロードマップ.md`

---

*Generated: 2026-04-28 by Claudian*
