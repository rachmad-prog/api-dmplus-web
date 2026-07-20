const crypto = require("crypto");

// Captcha sederhana (soal penjumlahan) yang stateless — cocok untuk environment
// serverless (Vercel) karena tidak perlu simpan soal di memori/DB.
// Cara kerja: server generate 2 angka acak + waktu kedaluwarsa, lalu tanda-tangani
// (HMAC) supaya klien tidak bisa mengubah/memalsukan jawaban yang "benar".
// Saat verifikasi, server hitung ulang HMAC dari data yang dikirim klien dan
// bandingkan dengan token — kalau cocok & belum kedaluwarsa & jawaban benar, lolos.

const CAPTCHA_TTL_MS = 5 * 60 * 1000; // soal berlaku 5 menit

function getSecret() {
  return process.env.CAPTCHA_SECRET || process.env.JWT_SECRET || "dev-captcha-secret";
}

function sign(a, b, expiresAt) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${a}:${b}:${expiresAt}`)
    .digest("hex");
}

function generateCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1; // 1-10
  const b = Math.floor(Math.random() * 10) + 1; // 1-10
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  const token = sign(a, b, expiresAt);
  return { a, b, expiresAt, token };
}

function verifyCaptcha({ a, b, expiresAt, token, answer }) {
  if (
    typeof a !== "number" ||
    typeof b !== "number" ||
    typeof expiresAt !== "number" ||
    typeof token !== "string" ||
    (typeof answer !== "number" && typeof answer !== "string")
  ) {
    return { ok: false, reason: "Data verifikasi tidak lengkap" };
  }

  if (Date.now() > expiresAt) {
    return { ok: false, reason: "Soal verifikasi sudah kedaluwarsa, coba lagi" };
  }

  const expectedToken = sign(a, b, expiresAt);
  const tokenBuf = Buffer.from(token, "hex");
  const expectedBuf = Buffer.from(expectedToken, "hex");
  if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    return { ok: false, reason: "Soal verifikasi tidak valid" };
  }

  const numericAnswer = Number(answer);
  if (!Number.isFinite(numericAnswer) || numericAnswer !== a + b) {
    return { ok: false, reason: "Jawaban verifikasi salah" };
  }

  return { ok: true };
}

module.exports = { generateCaptcha, verifyCaptcha };
