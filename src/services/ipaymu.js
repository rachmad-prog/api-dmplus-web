const crypto = require("crypto");

// ====== Konfigurasi iPaymu Redirect Payment (API v2) ======
// Dokumentasi resmi: https://docs.ipaymu.com/id/docs
const IS_PRODUCTION = process.env.IPAYMU_IS_PRODUCTION === "true";
const BASE_URL = IS_PRODUCTION ? "https://my.ipaymu.com" : "https://sandbox.ipaymu.com";
const PAYMENT_PATH = "/api/v2/payment";
// POST /api/v2/transaction — cek status transaksi langsung ke iPaymu tanpa
// perlu menunggu webhook. Dipakai sebagai fallback active-sync, sama seperti
// checkTransactionStatus() di services/doku.js.
const TRANSACTION_PATH = "/api/v2/transaction";
// Path notifikasi/callback — harus SAMA PERSIS dengan path route webhook di
// app.js/payments.js, dan didaftarkan sebagai "notifyUrl" di setiap request
// pembuatan transaksi (iPaymu tidak punya Notification URL statis per akun
// seperti Doku, jadi tidak perlu trik override_notification_url).
const NOTIFICATION_PATH = "/api/payments/ipaymu/notification";

function isConfigured() {
  return Boolean(process.env.IPAYMU_VA && process.env.IPAYMU_API_KEY);
}

// String to Sign = Method:VA:SHA256(RequestBody dalam hex lowercase):ApiKey
// Signature = HMAC-SHA256(String to Sign, ApiKey) dalam hex lowercase
// Referensi: https://docs.ipaymu.com/id/docs/signature
function generateSignature({ method, va, rawBody, apiKey }) {
  const bodyHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  const stringToSign = `${method}:${va}:${bodyHash}:${apiKey}`;
  return crypto.createHmac("sha256", apiKey).update(stringToSign, "utf8").digest("hex");
}

// Timestamp format yang diminta iPaymu: YYYYMMDDHHmmss
function generateTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

// POST /api/v2/payment — buat halaman pembayaran iPaymu (Redirect Payment),
// mengembalikan Data.Url (payment page) & Data.SessionID.
async function createRedirectPayment({ referenceId, items, customer, returnUrl, cancelUrl }) {
  if (!isConfigured()) {
    throw new Error("iPaymu belum dikonfigurasi (IPAYMU_VA / IPAYMU_API_KEY kosong di .env)");
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    console.warn(
      "[ipaymu] BACKEND_URL belum di-set — notifyUrl tidak bisa dikirim ke iPaymu, " +
        "notifikasi pembayaran otomatis tidak akan diterima (customer tetap bisa bayar, " +
        "tapi status order harus dicek manual)."
    );
  }

  const body = {
    product: items.map((item) => item.name),
    qty: items.map((item) => String(item.quantity)),
    price: items.map((item) => String(item.price)),
    returnUrl,
    cancelUrl,
    // Masa berlaku pembayaran (24 jam) — field ini disebut wajib di sebagian
    // dokumentasi resmi iPaymu Redirect Payment v2. Tanpa ini, iPaymu bisa
    // menerima transaksi tapi gagal ("UNCAUGHT_ERROR") saat mencoba generate
    // VA di step berikutnya (setelah customer pilih bank).
    expired: 24,
    expiredType: "hours",
    ...(backendUrl && { notifyUrl: `${backendUrl}${NOTIFICATION_PATH}` }),
    buyerName: customer.name,
    buyerEmail: customer.email,
    buyerPhone: customer.phone,
    referenceId,
  };

  const rawBody = JSON.stringify(body);
  const timestamp = generateTimestamp();
  const signature = generateSignature({
    method: "POST",
    va: process.env.IPAYMU_VA,
    rawBody,
    apiKey: process.env.IPAYMU_API_KEY,
  });

  const res = await fetch(`${BASE_URL}${PAYMENT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      va: process.env.IPAYMU_VA,
      signature,
      timestamp,
    },
    body: rawBody,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.Status !== 200 || !json?.Data?.Url) {
    const message = json?.Message || `Gagal membuat transaksi iPaymu (HTTP ${res.status})`;
    const err = new Error(message);
    err.raw = json;
    throw err;
  }

  return {
    paymentUrl: json.Data.Url,
    sessionId: json.Data.SessionID,
    raw: json,
  };
}

// POST /api/v2/transaction — cek status transaksi langsung ke iPaymu (fallback
// active-sync), dipanggil dengan transactionId dari hasil createRedirectPayment
// (json.Data.TransactionId). Header & skema signature sama persis dengan
// createRedirectPayment() di atas (va + signature + timestamp, HMAC-SHA256
// dari body JSON). Catatan: skema response endpoint ini tidak seragam di
// seluruh dokumentasi/SDK unofficial iPaymu yang beredar, jadi mapping status
// di bawah dibuat selonggar mungkin (best-effort) dan SELALU dibarengi dengan
// webhook sebagai sumber utama — kegagalan/skema tak terduga di sini tidak
// boleh sampai menimpa status yang sudah benar dari webhook.
async function checkTransactionStatus(transactionId) {
  if (!isConfigured()) {
    throw new Error("iPaymu belum dikonfigurasi (IPAYMU_VA / IPAYMU_API_KEY kosong di .env)");
  }

  const body = { transactionId: String(transactionId) };
  const rawBody = JSON.stringify(body);
  const timestamp = generateTimestamp();
  const signature = generateSignature({
    method: "POST",
    va: process.env.IPAYMU_VA,
    rawBody,
    apiKey: process.env.IPAYMU_API_KEY,
  });

  const res = await fetch(`${BASE_URL}${TRANSACTION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      va: process.env.IPAYMU_VA,
      signature,
      timestamp,
    },
    body: rawBody,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.Status !== 200) {
    const message = json?.Message || `Gagal cek status iPaymu (HTTP ${res.status})`;
    const err = new Error(message);
    err.raw = json;
    err.notFound = res.status === 404;
    throw err;
  }

  // Field nama status di response tidak konsisten di berbagai versi
  // dokumentasi/SDK iPaymu ("Status"/"status", "StatusDesc"/"status_desc"),
  // jadi dicoba beberapa kemungkinan lokasi field.
  const data = json?.Data || json?.data || {};
  const rawStatus = data.Status ?? data.status ?? data.TransactionStatus ?? data.status_desc;
  const statusText = String(rawStatus ?? "").toLowerCase();

  let normalizedStatus = "PENDING";
  if (["1", "success", "berhasil", "settlement", "paid"].includes(statusText)) {
    normalizedStatus = "PAID";
  } else if (["-1", "-2", "failed", "gagal", "cancel", "cancelled", "batal"].includes(statusText)) {
    normalizedStatus = "FAILED";
  } else if (["expired", "expire", "kadaluarsa"].includes(statusText)) {
    normalizedStatus = "EXPIRED";
  }

  return {
    normalizedStatus,
    raw: json,
  };
}

// Normalisasi tipe data payload callback sebelum dipakai untuk hitung ulang
// signature — mengikuti persis panduan resmi iPaymu (beberapa field wajib
// Integer/Boolean/Array walau datang sebagai string, terutama kalau content-type
// callback di dashboard iPaymu di-set ke x-www-form-urlencoded).
function normalizeCallbackData(rawData) {
  const result = {};
  for (const key of Object.keys(rawData)) {
    const val = rawData[key];
    if (key === "is_escrow") {
      result[key] = val === true || val === "true" || val === "1" || val === 1;
    } else if (["trx_id", "status_code", "transaction_status_code", "paid_off"].includes(key)) {
      result[key] = typeof val === "number" ? val : parseInt(val, 10);
    } else if (key === "additional_info") {
      if (val === "[]" || val === undefined || val === null) result[key] = [];
      else result[key] = val;
    } else {
      result[key] = String(val);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(result, "additional_info")) {
    result.additional_info = [];
  }
  return result;
}

function sortKeysAscending(obj) {
  return Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .reduce((sorted, key) => {
      sorted[key] = obj[key];
      return sorted;
    }, {});
}

// Verifikasi header X-Signature pada notifikasi callback dari iPaymu, supaya
// dipastikan benar-benar berasal dari iPaymu (bukan orang lain yang menembak
// endpoint webhook secara langsung). Secret key yang dipakai BUKAN API Key,
// melainkan Nomor VA akun iPaymu (lihat dokumentasi resmi iPaymu > Callback).
function verifyNotificationSignature(req) {
  if (!isConfigured()) return false;

  const receivedSignature = req.headers["x-signature"];
  if (!receivedSignature) return false;

  const { signature, ...bodyWithoutSignature } = req.body || {};
  const normalized = normalizeCallbackData(bodyWithoutSignature);
  const sorted = sortKeysAscending(normalized);

  let jsonBody = JSON.stringify(sorted);
  jsonBody = jsonBody.replace(/\//g, "\\/");

  const expectedSignature = crypto
    .createHmac("sha256", process.env.IPAYMU_VA)
    .update(jsonBody, "utf8")
    .digest("hex");

  const a = Buffer.from(receivedSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  isConfigured,
  createRedirectPayment,
  checkTransactionStatus,
  verifyNotificationSignature,
  NOTIFICATION_PATH,
};
