/**
 * すみこ代理AI Cron エンドポイント
 *
 * Vercel Hobby は1日1回のCron制限があるため、
 * 1つのエンドポイントで朝/夕の両方を時刻判定式で処理する。
 *
 * Cron スケジュール例（vercel.json）:
 *   "schedule": "0 23 * * *"   ← UTC 23:00 = JST 8:00 月-日
 *   ※ Vercel Hobbyの制限内で動かすため、平日/時刻チェックは関数内で
 *
 * 手動テスト用：
 *   GET /api/sumiko-cron?mode=morning   → 朝Push 強制実行
 *   GET /api/sumiko-cron?mode=evening   → 夕Push 強制実行
 *   GET /api/sumiko-cron                → 現在時刻で自動判定
 */

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const sumiko = require("../lib/sumiko");

module.exports = async (req, res) => {
  const queryMode = req.query?.mode; // "morning" | "evening" | undefined
  const dryRun = req.query?.dry === "1";

  // 認証（オプショナル）：Vercel Cron は通常 Vercel-Cron ヘッダ付き
  // 手動テストは ?key=... で許可
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers["user-agent"]?.includes("vercel-cron") || false;
  const isAuthorized = isVercelCron
    || (cronSecret && authHeader === `Bearer ${cronSecret}`)
    || queryMode; // queryModeが明示なら手動テスト扱い（あとで強化）

  if (!isAuthorized && !dryRun) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // モード決定
  const { dateStr, dayOfWeek, isWeekend } = sumiko.getJSTDate();
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstHour = jstNow.getUTCHours();
  const jstMin = jstNow.getUTCMinutes();

  let mode = queryMode;
  if (!mode) {
    // 自動判定：JST 7:55-8:30 → morning, 17:00-17:45 → evening
    if (jstHour === 8 && jstMin <= 30) mode = "morning";
    else if (jstHour === 7 && jstMin >= 55) mode = "morning";
    else if (jstHour === 17 && jstMin >= 0 && jstMin <= 45) mode = "evening";
    else mode = null;
  }

  if (!mode) {
    return res.status(200).json({
      skipped: "not_in_window",
      jst: `${dateStr} ${dayOfWeek} ${jstHour}:${String(jstMin).padStart(2, "0")}`,
    });
  }

  // 平日チェック（手動テストはスキップ）
  if (!queryMode && isWeekend) {
    return res.status(200).json({
      skipped: "weekend",
      jst: `${dateStr} ${dayOfWeek}`,
    });
  }

  // ユーザー一覧
  const users = sumiko.getSumikoUsers();
  if (users.length === 0) {
    return res.status(200).json({
      skipped: "no_users",
      hint: "環境変数 SUMIKO_USERS を設定してください",
    });
  }

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      mode,
      jst: `${dateStr} ${dayOfWeek} ${jstHour}:${String(jstMin).padStart(2, "0")}`,
      wouldPushTo: users.filter(u => u.active).map(u => u.name),
    });
  }

  // 実行
  const results = [];
  for (const user of users) {
    if (!user.active) continue;
    try {
      if (mode === "morning") {
        await sumiko.startMorningCheckin(user.lineUserId, user.name);
      } else {
        await sumiko.startEveningCheckin(user.lineUserId, user.name);
      }
      results.push({ name: user.name, status: "ok" });
    } catch (err) {
      console.error(`Push error for ${user.name}:`, err);
      results.push({ name: user.name, status: "error", error: err.message });
    }
  }

  return res.status(200).json({
    ok: true,
    mode,
    jst: `${dateStr} ${dayOfWeek} ${jstHour}:${String(jstMin).padStart(2, "0")}`,
    count: results.length,
    results,
  });
};

// ローカル起動用
if (require.main === module) {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.get("/api/sumiko-cron", module.exports);
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`sumiko-cron server running on port ${port}`);
    console.log(`  Test: curl 'http://localhost:${port}/api/sumiko-cron?mode=morning&dry=1'`);
  });
}
