// Entry point untuk menjalankan server SECARA LOKAL (npm run dev / npm start)
// atau di platform non-serverless (Railway, Render, VPS, dll).
// Di Vercel, file ini TIDAK dipakai — Vercel pakai api/index.js yang langsung
// meng-import app dari ./app.js tanpa app.listen().
const app = require("./app");

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend jalan di http://localhost:${PORT}`);
});
