// Opsi cookie terpusat untuk token admin — dipakai bareng saat set (login)
// maupun clear (logout), supaya browser bisa betul-betul menghapusnya
// (kalau opsinya beda antara set & clear, browser tidak akan menganggapnya
// sebagai cookie yang sama).
//
// sameSite:"none" + secure:true dipakai di production karena frontend
// (mis. dmplus-web.vercel.app) dan backend (mis. api-dmplus-web.vercel.app)
// adalah domain berbeda — butuh cross-site cookie. Browser mewajibkan
// Secure=true kalau SameSite=None.
//
// Di development (NODE_ENV != "production"), dipakai sameSite:"lax" +
// secure:false supaya tetap jalan di http://localhost tanpa HTTPS.
function getAuthCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 12 * 60 * 60 * 1000, // samakan dengan expiresIn JWT (12h)
  };
}

const AUTH_COOKIE_NAME = "admin_token";

module.exports = { getAuthCookieOptions, AUTH_COOKIE_NAME };
