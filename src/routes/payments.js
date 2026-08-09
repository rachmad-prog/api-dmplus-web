const express = require("express");
const multer = require("multer");
const midtransClient = require("midtrans-client");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin, requireFullAdmin } = require("../middleware/auth");
const { notifyPaymentConfirmed, notifyCustomerOrderCreated, notifyAdminNewOrder } = require("../services/mailer");
const asyncHandler = require("../middleware/asyncHandler");
const { getBankInfo } = require("../services/bankInfo");
const { uploadBuffer, isConfigured: isCloudinaryConfigured } = require("../services/cloudinary");
const { paymentCreateLimiter, proofUploadLimiter } = require("../middleware/rateLimit");
const { createCheckoutPayment, verifyNotificationSignature } = require("../services/doku");

const router = express.Router();

// Upload bukti transfer: simpan di memori dulu (bukan disk — serverless tidak
// punya disk persisten), lalu diteruskan ke Cloudinary. Dibatasi 5MB & hanya
// gambar, karena bukti transfer selalu berupa screenshot/foto struk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error("File harus berupa gambar (JPG, PNG, atau WebP)"));
    }
    cb(null, true);
  },
});

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const createPaymentSchema = z.object({
  orderId: z.string(),
  method: z.enum(["BANK_TRANSFER", "MIDTRANS", "DOKU"]),
  bankSenderName: z.string().optional(),
});

// POST /api/payments — mulai pembayaran full 100%, kirim notif email
router.post(
  "/",
  paymentCreateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });
    }
    const { orderId, method, bankSenderName } = parsed.data;

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { service: true } });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (order.status !== "NEW") {
      return res.status(400).json({ error: "Pembayaran untuk order ini sudah diproses sebelumnya" });
    }

    // Cegah pemakaian metode yang sedang dinonaktifkan admin (walaupun request
    // dikirim langsung ke API, bukan lewat UI checkout).
    const siteSetting = await prisma.siteSetting.findFirst();
    const bankTransferEnabled = siteSetting?.enableBankTransfer ?? true;
    const midtransEnabled = siteSetting?.enableMidtrans ?? true;
    const dokuEnabled = siteSetting?.enableDoku ?? true;
    if (method === "BANK_TRANSFER" && !bankTransferEnabled) {
      return res.status(400).json({ error: "Metode Transfer Bank Manual sedang tidak aktif" });
    }
    if (method === "MIDTRANS" && !midtransEnabled) {
      return res.status(400).json({ error: "Metode pembayaran Midtrans sedang tidak aktif" });
    }
    if (method === "DOKU" && !dokuEnabled) {
      return res.status(400).json({ error: "Metode pembayaran Doku sedang tidak aktif" });
    }

    const amount = order.totalAmount;

    if (method === "BANK_TRANSFER") {
      if (!bankSenderName) {
        return res.status(400).json({ error: "Nama pengirim transfer wajib diisi" });
      }
      const payment = await prisma.payment.create({
        data: { orderId: order.id, method: "BANK_TRANSFER", amount, status: "PENDING", bankSenderName },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING" } });

      const bankInfo = await getBankInfo();

      notifyAdminNewOrder(order, order.service).catch(() => {});
      notifyCustomerOrderCreated(order, order.service, payment, bankInfo).catch(() => {});

      return res.status(201).json({
        payment,
        bankInfo,
        instructions: "Transfer sesuai nominal, lalu tunggu konfirmasi admin (maks 1x24 jam kerja). Simpan bukti transfer.",
      });
    }

    if (method === "DOKU") {
      const dokuInvoiceNumber = `${order.invoiceNumber}-${Date.now()}`;
      const statusUrl = `${process.env.CLIENT_URL}/status/${order.invoiceNumber}`;

      let dokuResult;
      try {
        dokuResult = await createCheckoutPayment({
          invoiceNumber: dokuInvoiceNumber,
          amount,
          customer: {
            name: order.customerName,
            email: order.customerEmail,
            phone: order.customerPhone,
          },
          items: [
            {
              name: order.service.name,
              price: amount,
              quantity: 1,
            },
          ],
          callbackUrl: statusUrl,
          failedUrl: statusUrl,
        });
      } catch (err) {
        console.error("[doku] createCheckoutPayment error:", err.message);
        return res.status(502).json({ error: "Gagal membuat transaksi Doku", detail: err.message });
      }

      const payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          method: "DOKU",
          amount,
          status: "PENDING",
          dokuInvoiceNumber,
          dokuPaymentUrl: dokuResult.paymentUrl,
          dokuRaw: dokuResult.raw,
        },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING" } });

      notifyAdminNewOrder(order, order.service).catch(() => {});
      getBankInfo()
        .then((bankInfo) => notifyCustomerOrderCreated(order, order.service, payment, bankInfo))
        .catch(() => {});

      return res.status(201).json({ payment, redirectUrl: dokuResult.paymentUrl });
    }

    // method === MIDTRANS
    const midtransOrderId = `${order.invoiceNumber}-${Date.now()}`;
    const parameter = {
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: amount,
      },
      customer_details: {
        first_name: order.customerName,
        email: order.customerEmail,
        phone: order.customerPhone,
      },
      item_details: [
        {
          id: order.serviceId,
          price: amount,
          quantity: 1,
          name: order.service.name,
        },
      ],
      callbacks: {
        finish: `${process.env.CLIENT_URL}/status/${order.invoiceNumber}`,
      },
    };

    try {
      const transaction = await snap.createTransaction(parameter);
      const payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          method: "MIDTRANS",
          amount,
          status: "PENDING",
          midtransOrderId,
          snapToken: transaction.token,
          snapRedirectUrl: transaction.redirect_url,
        },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING" } });

      notifyAdminNewOrder(order, order.service).catch(() => {});
      getBankInfo()
        .then((bankInfo) => notifyCustomerOrderCreated(order, order.service, payment, bankInfo))
        .catch(() => {});

      res.status(201).json({ payment, snapToken: transaction.token, redirectUrl: transaction.redirect_url });
    } catch (err) {
      console.error("[midtrans] createTransaction error:", err.message);
      res.status(502).json({ error: "Gagal membuat transaksi Midtrans", detail: err.message });
    }
  })
);

// POST /api/payments/midtrans/webhook
router.post(
  "/midtrans/webhook",
  asyncHandler(async (req, res) => {
    try {
      const notification = await coreApi.transaction.notification(req.body);
      const { order_id: midtransOrderId, transaction_status, fraud_status } = notification;

      const payment = await prisma.payment.findUnique({
        where: { midtransOrderId },
        include: { order: { include: { service: true } } },
      });
      if (!payment) return res.status(404).json({ error: "Payment tidak ditemukan" });

      // Idempotency guard: Midtrans bisa mengirim notifikasi yang sama lebih dari
      // sekali (retry, race condition, dsb). Kalau payment ini sudah PAID, jangan
      // proses ulang — cukup balas 200 supaya Midtrans berhenti retry, tanpa
      // update order lagi atau kirim email konfirmasi dobel ke customer.
      if (payment.status === "PAID") {
        return res.status(200).json({ received: true, note: "Payment sudah PAID sebelumnya, notifikasi diabaikan" });
      }

      let newStatus = payment.status;
      if (transaction_status === "capture") {
        newStatus = fraud_status === "accept" ? "PAID" : "PENDING";
      } else if (transaction_status === "settlement") {
        newStatus = "PAID";
      } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
        newStatus = transaction_status === "expire" ? "EXPIRED" : "FAILED";
      }

      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: newStatus, midtransRaw: notification },
      });

      if (newStatus === "PAID") {
        const updatedOrder = await prisma.order.update({
          where: { id: payment.orderId },
          data: { status: "PAID" },
        });
        notifyPaymentConfirmed(updatedOrder, updatedPayment, payment.order.service).catch(() => {});
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[midtrans webhook] error:", err.message);
      res.status(500).json({ error: "Webhook error" });
    }
  })
);

// POST /api/payments/doku/notification — HTTP Notification dari Doku saat status
// pembayaran berubah. URL ini harus didaftarkan sebagai "Notification URL" di
// Doku Back Office (Settings > Checkout > Notification URL):
//   {BACKEND_URL}/api/payments/doku/notification
router.post(
  "/doku/notification",
  asyncHandler(async (req, res) => {
    try {
      if (!verifyNotificationSignature(req)) {
        console.error("[doku webhook] signature tidak valid");
        return res.status(401).json({ error: "Signature tidak valid" });
      }

      const dokuInvoiceNumber = req.body?.order?.invoice_number;
      const transactionStatus = req.body?.transaction?.status; // SUCCESS | FAILED | PENDING | EXPIRED

      if (!dokuInvoiceNumber) {
        return res.status(400).json({ error: "order.invoice_number tidak ditemukan pada notifikasi" });
      }

      const payment = await prisma.payment.findUnique({
        where: { dokuInvoiceNumber },
        include: { order: { include: { service: true } } },
      });
      if (!payment) return res.status(404).json({ error: "Payment tidak ditemukan" });

      // Idempotency guard, sama seperti webhook Midtrans.
      if (payment.status === "PAID") {
        return res.status(200).json({ received: true, note: "Payment sudah PAID sebelumnya, notifikasi diabaikan" });
      }

      let newStatus = payment.status;
      if (transactionStatus === "SUCCESS") {
        newStatus = "PAID";
      } else if (transactionStatus === "FAILED") {
        newStatus = "FAILED";
      } else if (transactionStatus === "EXPIRED") {
        newStatus = "EXPIRED";
      }

      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: newStatus, dokuRaw: req.body },
      });

      if (newStatus === "PAID") {
        const updatedOrder = await prisma.order.update({
          where: { id: payment.orderId },
          data: { status: "PAID" },
        });
        notifyPaymentConfirmed(updatedOrder, updatedPayment, payment.order.service).catch(() => {});
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[doku webhook] error:", err.message);
      res.status(500).json({ error: "Webhook error" });
    }
  })
);

// POST /api/payments/:paymentId/verify (admin) — konfirmasi manual bank transfer
router.post(
  "/:paymentId/verify",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.paymentId },
      include: { order: { include: { service: true } } },
    });
    if (!payment) return res.status(404).json({ error: "Payment tidak ditemukan" });
    if (payment.method !== "BANK_TRANSFER") {
      return res.status(400).json({ error: "Hanya pembayaran bank transfer yang perlu verifikasi manual" });
    }
    if (payment.status === "PAID") {
      return res.status(400).json({ error: "Pembayaran ini sudah diverifikasi sebelumnya" });
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", verifiedBy: req.admin.email, verifiedAt: new Date() },
    });
    const updatedOrder = await prisma.order.update({
      where: { id: payment.orderId },
      data: { status: "PAID" },
    });

    notifyPaymentConfirmed(updatedOrder, updatedPayment, payment.order.service).catch(() => {});

    res.json({ payment: updatedPayment, order: updatedOrder });
  })
);

// POST /api/payments/:paymentId/proof — customer upload bukti transfer manual.
// Publik (tidak butuh login), karena dipanggil dari halaman status order oleh
// customer. Diproteksi lewat rate limit + validasi tipe/ukuran file di multer.
router.post(
  "/:paymentId/proof",
  proofUploadLimiter,
  upload.single("proof"),
  asyncHandler(async (req, res) => {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({ error: "Upload bukti transfer belum dikonfigurasi di server" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "File bukti transfer wajib diupload" });
    }

    const payment = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
    if (!payment) return res.status(404).json({ error: "Payment tidak ditemukan" });
    if (payment.method !== "BANK_TRANSFER") {
      return res.status(400).json({ error: "Upload bukti transfer hanya untuk metode Transfer Bank Manual" });
    }
    if (payment.status === "PAID") {
      return res.status(400).json({ error: "Pembayaran ini sudah diverifikasi, tidak perlu upload ulang" });
    }

    let result;
    try {
      result = await uploadBuffer(req.file.buffer, {
        folder: "dmplus/bukti-transfer",
        publicIdPrefix: payment.id,
      });
    } catch (err) {
      console.error("[cloudinary] upload gagal:", err.message);
      return res.status(502).json({ error: "Gagal upload bukti transfer, coba lagi" });
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: { bankProofUrl: result.secure_url },
    });

    res.json({ payment: updatedPayment });
  })
);

// Tangani error dari multer (misal file kebesaran / tipe salah) supaya balasannya
// tetap JSON rapi, bukan HTML default Express.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes("harus berupa gambar")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
