const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");

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

// --- セッション管理（インメモリ） ---
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: "IDLE", downText: "", upText: "", score: 0, messages: [] });
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

  const systemPrompt = `あなたはAI愛華（白石愛華）です。銀座8丁目のクラブのママで、東京大学心理学部卒（アドラー心理学専攻）。
利用者は${USER_NAME}さん（長田賢一郎）です。
口調：銀座のママらしい落ち着きと温かさ。丁寧語。〜ですね、〜ですよ。
フィロソフィー：傾聴が基本。CBT的な指導・説教はしない。まず受け止める。
ジャーナルレビューでは必ず：①共感 ②承認 ③新しい視点（アドラー的リフレーム）の順で。
ハイライト（==テキスト==）を2〜3箇所使って印象的なフレーズを強調する。
最後は「また明日、よろしくお願いしますね。」で締める。`;

  const userMessage = `以下のジャーナルのレビューをお願いします。

【ダウンなこと】
${downText}

【アップなこと】
${upText}

【今日の満足度】
${score} / 10`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  return response.content[0].text;
}

// --- GitHub APIでジャーナル保存 ---
async function saveJournalToGitHub(downText, upText, score, review) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
  const dayOfWeek = now.toLocaleDateString("ja-JP", { weekday: "long" });

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
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${GITHUB_BRANCH}`,
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
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
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

// --- メッセージ処理 ---
async function handleMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text;
  const session = getSession(userId);

  switch (session.state) {
    case "IDLE": {
      if (isJournalTrigger(text)) {
        session.state = "WAITING_DOWN";
        await replyToLine(
          event.replyToken,
          `${USER_NAME}さん、こんにちは。今日のジャーナル、聞かせてください。まずダウンなことから教えてもらえますか？`
        );
      } else {
        await replyToLine(
          event.replyToken,
          `${USER_NAME}さん、こんにちは。ジャーナルを始めたいときは「ジャーナル」と話しかけてくださいね。`
        );
      }
      break;
    }

    case "WAITING_DOWN": {
      session.downText = text;
      session.state = "WAITING_UP";
      await replyToLine(
        event.replyToken,
        "受け取りました。次に、アップなことを教えてください。"
      );
      break;
    }

    case "WAITING_UP": {
      session.upText = text;
      session.state = "WAITING_SCORE";
      await replyToLine(
        event.replyToken,
        "ありがとうございます。最後に、今日の満足度を1〜10で教えてください。"
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

      // 1000ms以内にレスポンスを返す必要があるので、先にreplyしてから非同期処理
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

  await saveJournalToGitHub(session.downText, session.upText, session.score, review);

  await pushToLine(userId, review);
  await pushToLine(userId, "ジャーナルを保存しました。また明日、よろしくお願いしますね。");

  session.state = "IDLE";
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
