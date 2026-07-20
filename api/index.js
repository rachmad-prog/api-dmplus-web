// Vercel serverless entry point.
// Vercel otomatis menjadikan tiap file di /api sebagai serverless function.
// Express app di sini di-export langsung (tanpa app.listen()) — Vercel yang
// akan memanggilnya sebagai request handler tiap ada request masuk.
module.exports = require("../src/app");
