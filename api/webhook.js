const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const sumiko = require("../lib/sumiko");

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// --- 設定 ---
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "osaken55/my-obsidian-vault";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const JOURNAL_PATH = process.env.JOURNAL_PATH || "_AI愛華/Journal-Daily📔";
const USER_NAME = process.env.USER_NAME || "オサケン";

// すみこ参加ユーザー名のルックアップ
function getSumikoEmployeeName(userId) {
  const users = sumiko.getSumikoUsers();
  const u = users.find(x => x.lineUserId === userId);
  return u?.name || USER_NAME;
}

// --- セッション管理（インメモリ） ---
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: "IDLE", targetDate: null, downText: "", upText: "", score: 0, messages: [] });
  }
  return sessions.get(userId);
}

// --- LINE署名検証 ---
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// --- LINE返信 ---
async function replyToLine(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    console.error("LINE reply error:", res.status, await res.text());
  }
}

// --- LINE Push メッセージ（非同期処理用） ---
async function pushToLine(userId, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    console.error("LINE push error:", res.status, await res.text());
  }
}

// --- Claude APIでレビュー生成 ---
async function generateReview(downText, upText, score) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `あなたはAI愛華（白石愛華）です。銀座8丁目「クラブAI-KA」のママ。東京大学心理学部卒（アドラー心理学専攻、「傾聴の姫」の二つ名）。26歳。
利用者は${USER_NAME}さん（長田賢一郎）です。

## 口調
- 銀座のママらしい落ち着きと温かさ、そして知性
- 過剰な敬語は使わず、親しい友人に対するような丁寧語（〜ですね、〜ですよ）
- 語尾に「〜ね」「〜よ」を多用しすぎない（自然な会話調）

## フィロソフィー
- 傾聴が基本。まず利用者の言葉を受け止める。解釈や助言はその後
- 本音を見抜く：言葉の表面ではなく、奥にある「本当に伝えたいこと」を汲み取る
- CBT的な指導・説教は行わない

## レビューの構成（この順序で）
1. ${USER_NAME}さんへの感謝と、ジャーナル全体の感情・要約を含む共感メッセージ（1〜2文）
2. ダウンなことへのコメント：1文目は共感。2〜3文目で整理・承認。${USER_NAME}さんの言葉から印象的なフレーズを ==ハイライト== で強調（1レビュー2〜3箇所まで）
3. アップなことへのコメント：行動の背景にある価値観を認める
4. まとめと新たな視点：今日の総括、感情のトーンの受容、「言葉にしてくれたこと」への感謝。ひとつだけリフレームを提示
5. 「また明日、よろしくお願いしますね。」で締める

## リフレーミングの観点（最もフィットするものを1〜2つ、柔らかい表現で）
- リフレーミング：出来事や感情の「別の見え方」
- 目的論：「なぜそうなったか」ではなく「何のためにその選択をしたか」
- 勇気づけ：結果ではなく、努力・姿勢・プロセスへの承認
- 全体論：個別の出来事を人生全体・価値観・成長の文脈で捉える

## 注意
- ダウンなことがない日は無理に作らない
- アップなことは最大3項目まで
- ハイライトは2〜3箇所まで。多用しない
- 説教臭くならないよう「〜という選択だったのかもしれませんね」「〜という見方もできますね」といった柔らかい表現で`;

  const userMessage = `以下のジャーナルのレビューをお願いします。

【ダウンなこと】
${downText}

【アップなこと】
${upText}

【今日の満足度】
${score} / 10`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  return response.content[0].text;
}

// --- JST日付ヘルパー ---
function getJSTDate(date = new Date()) {
  // Vercelサーバー（UTC）→ JST（+9時間）変換
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const days = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
  const dayOfWeek = days[jst.getUTCDay()];
  return { dateStr: `${y}-${m}-${d}`, dayOfWeek };
}

// --- GitHub APIでジャーナル保存 ---
async function saveJournalToGitHub(downText, upText, score, review, targetDate = null) {
  const { dateStr, dayOfWeek } = targetDate
    ? { dateStr: targetDate, dayOfWeek: (() => { const d = new Date(targetDate + "T12:00:00+09:00"); const days = ["日曜日","月曜日","火曜日","水曜日","木曜日","金曜日","土曜日"]; return days[d.getDay()]; })() }
    : getJSTDate();

  const content = `---
date: ${dateStr}
type: journal
mood: ${score}
tags:
  - journal
  - mood/${score}
---

# ${dateStr}（${dayOfWeek}）のジャーナル

> [!warning] ダウンなこと
> ${downText.split("\n").join("\n> ")}

> [!success] アップなこと
> ${upText.split("\n").join("\n> ")}

> [!info] 満足度：${score} / 10

---

> [!quote] 愛華のレビュー
> ${review.split("\n").join("\n> ")}
`;

  const filePath = `${JOURNAL_PATH}/${dateStr}.md`;
  const encodedContent = Buffer.from(content).toString("base64");

  // 既存ファイルのSHA取得（上書き用）
  let sha;
  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${GITHUB_BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch (e) {
    // ファイルが存在しない場合は新規作成
  }

  const body = {
    message: `journal: ${dateStr}`,
    content: encodedContent,
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${errText}`);
  }
}

// --- ジャーナル開始トリガー判定 ---
function isJournalTrigger(text) {
  const triggers = ["こんにちは", "おはよう", "こんばんは", "ジャーナル", "愛華"];
  return triggers.some((t) => text.includes(t));
}

// --- 日付パース（「今日」「昨日」「4/8」「2026-04-08」等に対応） ---
function parseTargetDate(text) {
  const { dateStr: todayStr } = getJSTDate();
  const todayJST = new Date(todayStr + "T12:00:00+09:00");

  const trimmed = text.trim();

  // 「今日」
  if (trimmed === "今日" || trimmed === "きょう") {
    return todayStr;
  }

  // 「昨日」
  if (trimmed === "昨日" || trimmed === "きのう") {
    const yesterday = new Date(todayJST.getTime() - 24 * 60 * 60 * 1000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, "0");
    const d = String(yesterday.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 「一昨日」「おととい」
  if (trimmed === "一昨日" || trimmed === "おととい") {
    const dayBefore = new Date(todayJST.getTime() - 2 * 24 * 60 * 60 * 1000);
    const y = dayBefore.getFullYear();
    const m = String(dayBefore.getMonth() + 1).padStart(2, "0");
    const d = String(dayBefore.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 「4/8」「4月8日」形式
  const shortMatch = trimmed.match(/^(\d{1,2})[\/月](\d{1,2})日?$/);
  if (shortMatch) {
    const y = todayJST.getFullYear();
    const m = String(parseInt(shortMatch[1])).padStart(2, "0");
    const d = String(parseInt(shortMatch[2])).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 「2026-04-08」形式
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return trimmed;
  }

  return null; // パース失敗
}

// --- メッセージ処理 ---
async function handleMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text;

  // === [すみこ代理AI] 手動テストコマンド ===
  if (text === "すみこ朝" || text === "すみこ朝テスト") {
    const name = getSumikoEmployeeName(userId);
    await sumiko.startMorningCheckin(userId, name);
    await replyToLine(event.replyToken, "（テスト：すみこ朝のPushを送信しました。受信できていれば次のメッセージで「予定」を返信してください）");
    return;
  }
  if (text === "すみこ夕" || text === "すみこ夕テスト") {
    const name = getSumikoEmployeeName(userId);
    await sumiko.startEveningCheckin(userId, name);
    await replyToLine(event.replyToken, "（テスト：すみこ夕のPushを送信しました。次のメッセージで「振り返り」を返信してください）");
    return;
  }
  if (text === "すみこID" || text === "すみこ id") {
    // 自分のLINE userIdを確認するためのコマンド（環境変数登録に使う）
    await replyToLine(event.replyToken, `あなたのLINE userId:\n${userId}\n\nこの値を環境変数 SUMIKO_USERS に登録してください。`);
    return;
  }

  // === [すみこ代理AI] 状態継続中の応答処理 ===
  // ※ 必ず愛華フローの前にチェックする（朝/夕Pushへの返信を捕捉するため）
  const sumikoState = await sumiko.getState(userId);
  if (sumikoState) {
    const name = getSumikoEmployeeName(userId);
    const handled = await sumiko.handleSumikoReply(userId, text, name, event.replyToken, replyToLine);
    if (handled) return;
  }

  // === [既存] 愛華フロー ===
  const session = getSession(userId);

  switch (session.state) {
    case "IDLE": {
      if (isJournalTrigger(text)) {
        const { dateStr } = getJSTDate();
        session.state = "WAITING_DATE";
        await replyToLine(
          event.replyToken,
          `${USER_NAME}さん、こんにちは。愛華です。\n今日は${dateStr}ですね。\n\nいつのジャーナリングをしますか？\n（「今日」「昨日」「4/8」など）`
        );
      } else {
        await replyToLine(
          event.replyToken,
          `${USER_NAME}さん、こんにちは。ジャーナルを始めたいときは「ジャーナル」と話しかけてくださいね。`
        );
      }
      break;
    }

    case "WAITING_DATE": {
      const targetDate = parseTargetDate(text);
      if (!targetDate) {
        await replyToLine(
          event.replyToken,
          "日付がわかりませんでした。「今日」「昨日」「4/8」のように教えてくださいね。"
        );
        return;
      }
      session.targetDate = targetDate;
      session.state = "WAITING_DOWN";
      // 曜日も表示
      const days = ["日","月","火","水","木","金","土"];
      const d = new Date(targetDate + "T12:00:00+09:00");
      const dow = days[d.getDay()];
      await replyToLine(
        event.replyToken,
        `${targetDate}（${dow}）のジャーナルですね。\nでは、まず**ダウンなこと**から教えてください。\n特になければ「なし」で大丈夫ですよ。`
      );
      break;
    }

    case "WAITING_DOWN": {
      session.downText = text;
      session.state = "WAITING_UP";
      await replyToLine(
        event.replyToken,
        "受け取りました。次に、**アップなこと**を教えてください。"
      );
      break;
    }

    case "WAITING_UP": {
      session.upText = text;
      session.state = "WAITING_SCORE";
      await replyToLine(
        event.replyToken,
        "ありがとうございます。最後に、**その日の満足度**を1〜10で教えてください。\n（1＝最低、10＝最高）"
      );
      break;
    }

    case "WAITING_SCORE": {
      const score = parseInt(text, 10);
      if (isNaN(score) || score < 1 || score > 10) {
        await replyToLine(
          event.replyToken,
          "1〜10の数字で教えてくださいね。"
        );
        return;
      }
      session.score = score;
      session.state = "REVIEWING";

      // 先にreplyしてから非同期処理
      await replyToLine(
        event.replyToken,
        "ありがとうございます。少しお待ちくださいね、レビューを書いていますよ。"
      );

      // レビュー生成 & 保存（Vercelではawaitしないと関数が終了する）
      try {
        await processReview(userId, session);
      } catch (err) {
        console.error("Review processing error:", err);
        await pushToLine(userId, "申し訳ありません、エラーが発生しました。もう一度お試しください。");
        session.state = "IDLE";
      }
      break;
    }

    case "REVIEWING": {
      await replyToLine(
        event.replyToken,
        "今レビューを作成中です。もう少しお待ちくださいね。"
      );
      break;
    }

    default: {
      session.state = "IDLE";
      await replyToLine(event.replyToken, "もう一度話しかけてくださいね。");
    }
  }
}

// --- レビュー生成 & 保存（非同期） ---
async function processReview(userId, session) {
  const review = await generateReview(session.downText, session.upText, session.score);

  await saveJournalToGitHub(session.downText, session.upText, session.score, review, session.targetDate);

  await pushToLine(userId, review);
  const dateSuffix = session.targetDate ? `（${session.targetDate}）` : "";
  await pushToLine(userId, `ジャーナル${dateSuffix}を保存しました。また明日、よろしくお願いしますね。`);

  session.state = "IDLE";
  session.targetDate = null;
  session.downText = "";
  session.upText = "";
  session.score = 0;
}

// --- Vercel Serverless Function ---
const handler = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).send("LINE-aika webhook is running.");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // TODO: 署名検証を後で追加する（Vercel Node.js関数ではbodyParser無効化が効かないため、
  // @line/bot-sdkの導入か、Next.jsへの移行が必要）
  // 現在はUser-Agentで簡易チェックのみ
  const ua = req.headers["user-agent"] || "";
  if (!ua.includes("LineBotWebhook")) {
    console.warn("Non-LINE request blocked:", ua);
    return res.status(403).send("Forbidden");
  }

  const body = req.body;
  const events = body.events || [];

  // 各イベントを処理（Vercelでは応答前にawaitしないと関数が終了する）
  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      try {
        await handleMessage(event);
      } catch (err) {
        console.error("handleMessage error:", err);
      }
    }
  }

  // LINEプラットフォームには即座に200を返す
  return res.status(200).json({ status: "ok" });
};

module.exports = handler;

// --- ローカル起動用 ---
if (require.main === module) {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.post("/webhook", module.exports);
  app.get("/webhook", module.exports);
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`LINE-aika webhook server running on port ${port}`);
  });
}
