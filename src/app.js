require("dotenv").config();

// Sentry HARUS di-require sebelum express & modul lain (lihat komentar di
// instrument.js) supaya auto-instrumentation-nya lengkap.
const { Sentry, isConfigured: isSentryConfigured } = require("./instrument");

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");

const servicesRoutes = require("./routes/services");
const ordersRoutes = require("./routes/orders");
const paymentsRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const pixelsRoutes = require("./routes/pixels");
const bankSettingsRoutes = require("./routes/bankSettings");
const siteSettingsRoutes = require("./routes/siteSettings");

const app = express();

app.use(helmet());

// PENTING: CORS harus origin spesifik (bukan "*") + credentials:true, karena
// token admin sekarang dikirim lewat httpOnly cookie cross-site. Browser
// menolak kombinasi Access-Control-Allow-Origin:"*" dengan credentials:true.
if (!process.env.CLIENT_URL) {
  console.warn("[cors] CLIENT_URL belum di-set — cookie admin (httpOnly) tidak akan berfungsi cross-site.");
}
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(morgan("dev"));
// simpan raw body (dipakai untuk verifikasi Signature notifikasi Doku, yang
// dihitung dari hash body mentah — bukan dari objek JSON yang sudah di-parse)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/services", servicesRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pixels", pixelsRoutes);
app.use("/api/bank-settings", bankSettingsRoutes);
app.use("/api/site-settings", siteSettingsRoutes);

// Sentry error handler HARUS dipasang setelah semua route, tapi sebelum
// error handler generik di bawah ini — supaya error yang lolos ke sana
// sudah tercatat di Sentry duluan.
if (isSentryConfigured()) {
  Sentry.setupExpressErrorHandler(app);
}

// Error handler terakhir
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Terjadi kesalahan pada server" });
});

// Jaring pengaman terakhir: kalau ada error async yang lolos (misal lupa asyncHandler
// di route baru), server LOG errornya saja, tidak ikut mati.
// (Di Vercel serverless, tiap request punya siklus hidup sendiri, tapi ini tetap
// berguna untuk mode lokal / server tradisional.)
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  if (isSentryConfigured()) Sentry.captureException(reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  if (isSentryConfigured()) Sentry.captureException(err);
});

module.exports = app;
