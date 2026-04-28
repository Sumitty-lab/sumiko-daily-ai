/**
 * すみこ代理AI - 夕方のCron
 * Vercel Cron スケジュール: "30 8 * * *" (UTC 8:30 = JST 17:30)
 */
const handler = require("./sumiko-cron");

module.exports = async (req, res) => {
  req.query = { ...req.query, mode: "evening" };
  return handler(req, res);
};
