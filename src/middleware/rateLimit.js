const rateLimit = require("express-rate-limit");

// Response format konsisten dengan error handler lain di project ini (pakai key "error").
function handler(message) {
  return (req, res) => {
    res.status(429).json({ error: message });
  };
}

// Login admin — target utama brute force. Dibatasi ketat per IP.
// Captcha di route login sudah bantu, tapi rate limit tetap perlu karena
// captcha math sederhana masih bisa di-automate.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  limit: 10, // maksimal 10 percobaan login per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("Terlalu banyak percobaan login. Coba lagi dalam beberapa menit."),
});

// Pembuatan order (checkout publik) — cegah spam order/invoice palsu.
const orderCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  limit: 20, // 20 order baru per IP per jam, cukup longgar untuk pemakaian wajar
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("Terlalu banyak percobaan order. Coba lagi nanti."),
});

// Inisiasi pembayaran (Midtrans/bank transfer) — endpoint yang memicu email &
// (untuk Midtrans) transaksi ke pihak ketiga, jadi perlu dibatasi juga.
const paymentCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("Terlalu banyak percobaan pembayaran. Coba lagi nanti."),
});

// Upload bukti transfer — dibatasi per IP supaya tidak dipakai untuk spam
// upload file besar berulang-ulang (biaya storage & bandwidth Cloudinary).
const proofUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: handler("Terlalu banyak percobaan upload. Coba lagi nanti."),
});

module.exports = { loginLimiter, orderCreateLimiter, paymentCreateLimiter, proofUploadLimiter };
