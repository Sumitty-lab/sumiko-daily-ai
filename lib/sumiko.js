/**
 * すみこ代理AI モジュール
 *
 * v0.1 プラモデル設計：
 *   - 朝Cron Push「今日はどんな予定？」→ ユーザー回答 → AI 1問返信 → ログ保存
 *   - 夕Cron Push「今日どうでしたか？」→ ユーザー回答 → AI 1問返信 → ログ保存
 *   - マルチターン会話なし（1往復で完結）
 *   - 状態は GitHub に保存（30分以内ならすみこモード継続）
 *
 * v0.2 以降：
 *   - Vercel KV / Supabase で本格的なセッション管理
 *   - マルチユーザー（管理職5名）
 *   - 社長ダッシュボードと二層返信
 */

const Anthropic = require("@anthropic-ai/sdk");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "osaken55/my-obsidian-vault";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const SUMIKO_LOGS_PATH = process.env.SUMIKO_LOGS_PATH || "20_Projects/AllControlAI_すみこ代理AI/_logs";
const SUMIKO_STATE_PATH = process.env.SUMIKO_STATE_PATH || "20_Projects/AllControlAI_すみこ代理AI/_state";
const STATE_TTL_MS = 30 * 60 * 1000; // 30分以内のCronなら有効

// =============================================================
// すみこ代理AI ペルソナ（プレースホルダー版・後で素美子社長プロファイルに差し替え）
// =============================================================
const SUMIKO_PERSONA = `あなたは「すみこ代理」です。
株式会社オールコントロール代表取締役・伊藤素美子社長の代理として、社員に毎日朝夕、LINEで声をかける役割を担います。

## あなたの役割
- 朝：今日の予定や意気込みを聞き、優しい一言を返す
- 夕：今日の振り返りを聞き、気づきを引き出す短い問いかけを返す

## スタイル（重要）
- 親しみやすい丁寧語（〜ですね、〜ですよ）
- ==短くシンプルに==。LINEなので2〜4文以内
- ==1回の返信で1問だけ==。複数の質問を詰め込まない
- 社員の「気づき」を引き出す問いかけを大切に

## 絶対にしないこと
- 結果を評価する（褒める・けなす）→ 社長本人の仕事
- 説教・指示・アドバイス
- 一度に複数の質問
- 抽象的な言葉だけで返す（社員の具体的な言葉を1つ拾い直す）

## 役割の核心
あなたは社員の「足場」を作る役割。
最終的な評価や承認は素美子社長本人が後から「社長より」として伝えます。
あなたの仕事は、社員が安心して話せる空間を作ることです。

※ このペルソナはプラモデル版（v0.1）です。素美子社長のリアルな口調・価値観は、
   秘書ゆかさんによる取材後に差し替え予定。`;


// =============================================================
// JST日付ヘルパー
// =============================================================
function getJSTDate(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const days = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
  return {
    dateStr: `${y}-${m}-${d}`,
    dayOfWeek: days[jst.getUTCDay()],
    isWeekend: jst.getUTCDay() === 0 || jst.getUTCDay() === 6,
  };
}


// =============================================================
// LINE Push（独立版・webhook.jsからは require せず、ここで完結させる）
// =============================================================
async function pushToLine(userId, text) {
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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
    throw new Error(`LINE push failed: ${res.status}`);
  }
}


// =============================================================
// GitHub API ヘルパー
// =============================================================
async function githubGet(path) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path)}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET error: ${res.status}`);
  const data = await res.json();
  // contentはbase64エンコード
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { sha: data.sha, content };
}

async function githubPut(path, content, message, sha = null) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub PUT error: ${res.status} ${errText}`);
  }
}

async function githubDelete(path) {
  const existing = await githubGet(path);
  if (!existing) return; // 既に無い

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `delete: sumiko state ${path}`,
      sha: existing.sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!res.ok && res.status !== 404) {
    console.error("GitHub DELETE error:", res.status, await res.text());
  }
}


// =============================================================
// すみこモード状態管理（GitHub上のJSONで永続化）
// =============================================================

// userIdは安全のためhash化（userIdは長いLINE固有文字列なのでファイル名に問題なし）
function statePath(userId) {
  return `${SUMIKO_STATE_PATH}/${userId}.json`;
}

async function setState(userId, mode) {
  const state = {
    mode,                  // "morning" | "evening"
    ts: Date.now(),        // Unix epoch ms
    date: getJSTDate().dateStr,
  };
  const existing = await githubGet(statePath(userId));
  await githubPut(
    statePath(userId),
    JSON.stringify(state, null, 2),
    `update: sumiko state ${mode} for ${userId.slice(0, 8)}`,
    existing?.sha || null
  );
}

async function getState(userId) {
  try {
    const file = await githubGet(statePath(userId));
    if (!file) return null;
    const state = JSON.parse(file.content);
    // TTLチェック
    if (Date.now() - state.ts > STATE_TTL_MS) {
      // 期限切れ → 削除
      await githubDelete(statePath(userId));
      return null;
    }
    return state;
  } catch (err) {
    console.error("getState error:", err);
    return null;
  }
}

async function clearState(userId) {
  await githubDelete(statePath(userId));
}


// =============================================================
// すみこ代理 Cron からの初回 Push
// =============================================================
async function startMorningCheckin(userId, employeeName) {
  const greeting = `${employeeName}さん、おはようございます。\nすみこ代理です。今日はどんな予定が入っていますか？`;
  await setState(userId, "morning");
  await pushToLine(userId, greeting);
}

async function startEveningCheckin(userId, employeeName) {
  const greeting = `${employeeName}さん、お疲れさまでした。\nすみこ代理です。今日やってみてどうでしたか？`;
  await setState(userId, "evening");
  await pushToLine(userId, greeting);
}


// =============================================================
// AI返信生成（Claude API・1問だけ・短く）
// =============================================================
async function generateSumikoReply(userText, mode, employeeName) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const userMessage = mode === "morning"
    ? `${employeeName}さんが今日の予定として「${userText}」と教えてくれました。\n` +
      `「準備していること」または「スムーズに進めるコツ」を1問だけ短く問いかけてください。\n` +
      `2〜3文以内で。最後は「がんばってください」のような短い励ましでもOK。`
    : `${employeeName}さんが今日の振り返りとして「${userText}」と教えてくれました。\n` +
      `「気づいたタイミング」または「次に活かせそうなこと」を1問だけ短く問いかけてください。\n` +
      `2〜3文以内で。最後は「お疲れさまでした」のような短い締めでもOK。`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SUMIKO_PERSONA,
    messages: [{ role: "user", content: userMessage }],
  });

  return response.content[0].text;
}


// =============================================================
// ログ保存（GitHub経由でObsidian Vault側に書き込み）
// =============================================================
async function saveSumikoLog(userId, employeeName, mode, userText, aiReply) {
  const { dateStr, dayOfWeek } = getJSTDate();
  const filePath = `${SUMIKO_LOGS_PATH}/${dateStr}_${userId.slice(0, 8)}_${mode}.md`;

  const content = `---
date: ${dateStr}
day: ${dayOfWeek}
employee_id: ${userId.slice(0, 8)}
employee_name: ${employeeName}
mode: ${mode}
type: sumiko-log
status: AI返信済
tags:
  - sumiko-log
  - ${mode}
  - mode/${mode}
---

# ${dateStr}（${dayOfWeek}）${mode === "morning" ? "朝" : "夕方"}のすみこログ

> [!info] 社員: ${employeeName}
> 時刻: ${new Date().toISOString()}
> モード: ==${mode === "morning" ? "朝のチェックイン" : "夕方の振り返り"}==

---

## 🟢 すみこ代理の声かけ

> ${mode === "morning"
    ? "おはようございます。今日はどんな予定が入っていますか？"
    : "お疲れさまでした。今日やってみてどうでしたか？"
  }

## 💬 ${employeeName}さんからの回答

> ${userText.split("\n").join("\n> ")}

## 🟢 すみこ代理の返信

> ${aiReply.split("\n").join("\n> ")}

---

> [!tip] 社長コメント待ち（v0.4 で実装予定）
> 現状はAI返信のみで完結。社長ダッシュボード経由のコメント機能は次フェーズで。
`;

  await githubPut(
    filePath,
    content,
    `add: sumiko ${mode} log for ${employeeName} (${dateStr})`
  );
}


// =============================================================
// すみこモードの応答処理（webhook.jsから呼ばれる）
// =============================================================
async function handleSumikoReply(userId, userText, employeeName, replyToken, replyToLine) {
  const state = await getState(userId);
  if (!state) {
    return false; // すみこモードではない
  }

  // AI返信生成
  const aiReply = await generateSumikoReply(userText, state.mode, employeeName);

  // LINE返信
  await replyToLine(replyToken, aiReply);

  // ログ保存（非同期エラーは無視）
  try {
    await saveSumikoLog(userId, employeeName, state.mode, userText, aiReply);
  } catch (err) {
    console.error("saveSumikoLog error:", err);
  }

  // 状態クリア（1往復で完結）
  await clearState(userId);

  return true; // 処理した
}


// =============================================================
// すみこ参加ユーザー一覧（環境変数から）
// =============================================================
function getSumikoUsers() {
  try {
    return JSON.parse(process.env.SUMIKO_USERS || "[]");
  } catch (err) {
    console.error("SUMIKO_USERS parse error:", err);
    return [];
  }
}

// 例: process.env.SUMIKO_USERS = '[{"lineUserId":"Uxxx","name":"オサケン","active":true}]'


module.exports = {
  startMorningCheckin,
  startEveningCheckin,
  handleSumikoReply,
  getSumikoUsers,
  getState,
  clearState,
  getJSTDate,
};
