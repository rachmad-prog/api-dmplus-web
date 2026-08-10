const crypto = require("crypto");

// ====== Konfigurasi Doku Checkout ======
// Dokumentasi: https://developers.doku.com/accept-payments/doku-checkout
const IS_PRODUCTION = process.env.DOKU_IS_PRODUCTION === "true";
const BASE_URL = IS_PRODUCTION ? "https://api.doku.com" : "https://api-sandbox.doku.com";
const CHECKOUT_PATH = "/checkout/v1/payment";
// Path notification harus SAMA PERSIS dengan path route webhook di app.js/payments.js
// dan juga harus didaftarkan sebagai "Notification URL" di Doku Back Office
// (Settings > Checkout > Notification URL): {BACKEND_URL}/api/payments/doku/notification
const NOTIFICATION_PATH = "/api/payments/doku/notification";

function isConfigured() {
  return Boolean(process.env.DOKU_CLIENT_ID && process.env.DOKU_SECRET_KEY);
}

// Digest = base64(SHA256(rawBody)) — untuk request yang punya body (POST)
function generateDigest(rawBody) {
  return crypto.createHash("sha256").update(rawBody, "utf8").digest("base64");
}

// Signature = base64(HMAC-SHA256(secretKey, componentString)), diawali "HMACSHA256="
function generateSignature({ clientId, requestId, timestamp, requestTarget, digest, secretKey }) {
  let component = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${requestTarget}`;
  if (digest) component += `\nDigest:${digest}`;
  const hmac = crypto.createHmac("sha256", secretKey).update(component, "utf8").digest("base64");
  return `HMACSHA256=${hmac}`;
}

// POST /checkout/v1/payment — buat halaman pembayaran Doku, mengembalikan payment.url
async function createCheckoutPayment({ invoiceNumber, amount, customer, items, callbackUrl, failedUrl }) {
  if (!isConfigured()) {
    throw new Error("Doku belum dikonfigurasi (DOKU_CLIENT_ID / DOKU_SECRET_KEY kosong di .env)");
  }

  // BACKEND_URL harus menunjuk ke domain backend dmplus-web sendiri (bukan
  // CLIENT_URL yang merupakan domain frontend). Dipakai untuk
  // override_notification_url di bawah.
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    console.warn(
      "[doku] BACKEND_URL belum di-set — notifikasi DOKU akan mengandalkan " +
        "Notification URL statis di DOKU Back Office, yang bisa saja diarahkan " +
        "ke project lain kalau 1 API key dipakai untuk beberapa website."
    );
  }

  const body = {
    order: {
      invoice_number: invoiceNumber,
      amount,
      currency: "IDR",
      callback_url: callbackUrl,
      callback_url_cancel: failedUrl || callbackUrl,
      line_items: items,
      auto_redirect: true,
    },
    payment: {
      payment_due_date: 60,
    },
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      country: "ID",
    },
    // WAJIB kalau 1 API key DOKU dipakai untuk lebih dari satu website:
    // memaksa DOKU mengirim notifikasi transaksi ini ke webhook dmplus-web
    // sendiri, terlepas dari Notification URL statis apa pun yang di-set di
    // DOKU Back Office (yang cuma bisa diisi 1 URL untuk seluruh akun).
    // Pola yang sama dipakai project zilapage yang berbagi API key ini.
    ...(backendUrl && {
      additional_info: {
        override_notification_url: `${backendUrl}${NOTIFICATION_PATH}`,
      },
    }),
  };

  const rawBody = JSON.stringify(body);
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const digest = generateDigest(rawBody);
  const signature = generateSignature({
    clientId: process.env.DOKU_CLIENT_ID,
    requestId,
    timestamp,
    requestTarget: CHECKOUT_PATH,
    digest,
    secretKey: process.env.DOKU_SECRET_KEY,
  });

  const res = await fetch(`${BASE_URL}${CHECKOUT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": process.env.DOKU_CLIENT_ID,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: signature,
    },
    body: rawBody,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json?.response?.payment?.url) {
    const message = json?.error?.message || json?.message || "Gagal membuat transaksi Doku";
    const err = new Error(message);
    err.raw = json;
    throw err;
  }

  return {
    paymentUrl: json.response.payment.url,
    tokenId: json.response.payment.token_id,
    raw: json,
  };
}

// GET /orders/v1/status/{invoice_number} — cek status transaksi langsung ke
// Doku tanpa perlu menunggu webhook. Berguna sebagai fallback: dipanggil aktif
// oleh backend kita (bukan pasif menunggu notifikasi Doku), jadi status tetap
// bisa ter-update walau Notification URL belum/tidak dikonfigurasi di Doku
// Back Office. Bekerja sama baik untuk sandbox maupun production.
async function checkTransactionStatus(invoiceNumber) {
  if (!isConfigured()) {
    throw new Error("Doku belum dikonfigurasi (DOKU_CLIENT_ID / DOKU_SECRET_KEY kosong di .env)");
  }

  const requestTarget = `/orders/v1/status/${invoiceNumber}`;
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  // GET tidak punya body, jadi tidak perlu Digest (lihat dokumentasi Doku:
  // "For API that uses GET method such as Check Status API, merchant don't
  // need to generate a Digest").
  const signature = generateSignature({
    clientId: process.env.DOKU_CLIENT_ID,
    requestId,
    timestamp,
    requestTarget,
    digest: null,
    secretKey: process.env.DOKU_SECRET_KEY,
  });

  const res = await fetch(`${BASE_URL}${requestTarget}`, {
    method: "GET",
    headers: {
      "Client-Id": process.env.DOKU_CLIENT_ID,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: signature,
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || json?.message || `Gagal cek status Doku (HTTP ${res.status})`;
    const err = new Error(message);
    err.raw = json;
    err.notFound = res.status === 404;
    throw err;
  }

  return {
    transactionStatus: json?.transaction?.status, // SUCCESS | FAILED | PENDING | EXPIRED
    orderStatus: json?.order?.status, // ORDER_GENERATED | ORDER_EXPIRED | ORDER_RECOVERED
    raw: json,
  };
}

// Verifikasi Signature header pada HTTP Notification yang dikirim Doku ke
// webhook kita, supaya notifikasi dipastikan benar-benar berasal dari Doku
// (bukan orang lain yang menembak endpoint webhook secara langsung).
function verifyNotificationSignature(req) {
  if (!isConfigured()) return false;

  const clientId = req.headers["client-id"];
  const requestId = req.headers["request-id"];
  const timestamp = req.headers["request-timestamp"];
  const receivedSignature = req.headers["signature"];
  if (!clientId || !requestId || !timestamp || !receivedSignature) return false;

  const rawBody = req.rawBody || JSON.stringify(req.body);
  const digest = generateDigest(rawBody);
  const expectedSignature = generateSignature({
    clientId,
    requestId,
    timestamp,
    requestTarget: NOTIFICATION_PATH,
    digest,
    secretKey: process.env.DOKU_SECRET_KEY,
  });

  // Bandingkan dengan timing-safe compare untuk hindari timing attack
  const a = Buffer.from(receivedSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  createCheckoutPayment,
  checkTransactionStatus,
  verifyNotificationSignature,
  NOTIFICATION_PATH,
};
