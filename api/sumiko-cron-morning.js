/**
 * すみこ代理AI - 朝のCron
 * Vercel Cron スケジュール: "0 23 * * *" (UTC 23:00 = JST 8:00)
 */
const handler = require("./sumiko-cron");

module.exports = async (req, res) => {
  // 強制的に morning モードで呼び出し
  req.query = { ...req.query, mode: "morning" };
  return handler(req, res);
};
