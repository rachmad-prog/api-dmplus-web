// Inisialisasi Sentry — HARUS di-require paling awal (sebelum express & modul
// lain) supaya auto-instrumentation (http, express, dll) jalan dengan benar.
// Lihat: https://docs.sentry.io/platforms/javascript/guides/express/
//
// Kalau SENTRY_DSN belum di-set (mis. saat dev lokal), Sentry tidak
// diinisialisasi sama sekali — aplikasi tetap jalan normal tanpa error
// monitoring, cuma warning di log.
const Sentry = require("@sentry/node");

function isConfigured() {
  return Boolean(process.env.SENTRY_DSN);
}

if (isConfigured()) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    // 10% transaksi di-trace by default — cukup buat lihat performa tanpa
    // membanjiri quota Sentry. Bisa dinaikkan/diturunkan lewat env var.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
  console.log("[sentry] error monitoring aktif" + (process.env.SENTRY_ENVIRONMENT ? ` (${process.env.SENTRY_ENVIRONMENT})` : ""));
} else {
  console.warn("[sentry] SENTRY_DSN belum di-set — error monitoring nonaktif.");
}

module.exports = { Sentry, isConfigured };
