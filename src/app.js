require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const servicesRoutes = require("./routes/services");
const ordersRoutes = require("./routes/orders");
const paymentsRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const pixelsRoutes = require("./routes/pixels");
const bankSettingsRoutes = require("./routes/bankSettings");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(morgan("dev"));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/services", servicesRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/pixels", pixelsRoutes);
app.use("/api/bank-settings", bankSettingsRoutes);

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
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

module.exports = app;
