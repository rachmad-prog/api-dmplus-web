const jwt = require("jsonwebtoken");
const { AUTH_COOKIE_NAME } = require("../utils/authCookie");

function requireAdmin(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: "Token tidak ditemukan" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  }
}

// Middleware untuk aksi yang butuh akses penuh (bukan demo)
function requireFullAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.admin.role === "DEMO") {
      return res.status(403).json({ error: "Akun demo tidak dapat melakukan aksi ini. Hubungi admin." });
    }
    next();
  });
}

module.exports = { requireAdmin, requireFullAdmin };
