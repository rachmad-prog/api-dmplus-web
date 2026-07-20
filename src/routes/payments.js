const express = require("express");
const midtransClient = require("midtrans-client");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin } = require("../middleware/auth");
const { notifyPaymentConfirmed, notifyCustomerOrderCreated, notifyAdminNewOrder } = require("../services/mailer");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

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
  method: z.enum(["BANK_TRANSFER", "MIDTRANS"]),
  bankSenderName: z.string().optional(),
});

// POST /api/payments — mulai pembayaran full 100%, kirim notif email
router.post(
  "/",
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

    const amount = order.totalAmount;

    if (method === "BANK_TRANSFER") {
      if (!bankSenderName) {
        return res.status(400).json({ error: "Nama pengirim transfer wajib diisi" });
      }
      const payment = await prisma.payment.create({
        data: { orderId: order.id, method: "BANK_TRANSFER", amount, status: "PENDING", bankSenderName },
      });
      await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING" } });

      notifyAdminNewOrder(order, order.service).catch(() => {});
      notifyCustomerOrderCreated(order, order.service, payment).catch(() => {});

      let bankSetting = await prisma.bankSetting.findFirst();
      if (!bankSetting) {
        bankSetting = {
          bankName: process.env.BANK_NAME,
          accountNumber: process.env.BANK_ACCOUNT_NUMBER,
          accountHolder: process.env.BANK_ACCOUNT_HOLDER,
        };
      }

      return res.status(201).json({
        payment,
        bankInfo: {
          bankName: bankSetting.bankName,
          accountNumber: bankSetting.accountNumber,
          accountHolder: bankSetting.accountHolder,
        },
        instructions: "Transfer sesuai nominal, lalu tunggu konfirmasi admin (maks 1x24 jam kerja). Simpan bukti transfer.",
      });
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
      notifyCustomerOrderCreated(order, order.service, payment).catch(() => {});

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

// POST /api/payments/:paymentId/verify (admin) — konfirmasi manual bank transfer
router.post(
  "/:paymentId/verify",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.paymentId },
      include: { order: { include: { service: true } } },
    });
    if (!payment) return res.status(404).json({ error: "Payment tidak ditemukan" });
    if (payment.method !== "BANK_TRANSFER") {
      return res.status(400).json({ error: "Hanya pembayaran bank transfer yang perlu verifikasi manual" });
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

module.exports = router;
