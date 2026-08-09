const express = require("express");
const { z } = require("zod");
const midtransClient = require("midtrans-client");
const prisma = require("../prisma");
const { requireAdmin, requireFullAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getBankInfo } = require("../services/bankInfo");
const { orderCreateLimiter } = require("../middleware/rateLimit");
const { notifyOrderCancelled, notifyPaymentConfirmed } = require("../services/mailer");
const { checkTransactionStatus: checkDokuStatus, isConfigured: isDokuConfigured } = require("../services/doku");

const router = express.Router();

const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const createOrderSchema = z.object({
  serviceSlug: z.string(),
  customerName: z.string().trim().min(2, "Nama lengkap wajib diisi (min. 2 karakter)"),
  customerEmail: z.string().trim().email("Format email tidak valid"),
  customerPhone: z.string().trim().min(8, "No. WhatsApp wajib diisi (min. 8 karakter)"),
  businessName: z.string().trim().min(1, "Nama bisnis wajib diisi"),
  notes: z.string().trim().min(1, "Catatan wajib diisi"),
});

function generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${y}${m}${d}-${rand}`;
}

// POST /api/orders — bikin order baru dari halaman checkout (belum kirim notif)
router.post(
  "/",
  orderCreateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return res.status(400).json({
        error: firstIssue?.message || "Data tidak valid",
        details: parsed.error.flatten(),
      });
    }
    const data = parsed.data;

    const service = await prisma.service.findUnique({ where: { slug: data.serviceSlug } });
    if (!service || !service.isActive) {
      return res.status(404).json({ error: "Paket tidak ditemukan" });
    }

    const order = await prisma.order.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        serviceId: service.id,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        businessName: data.businessName,
        notes: data.notes,
        totalAmount: service.priceFinal,
        status: "NEW",
      },
    });

    const bankInfo = await getBankInfo();

    res.status(201).json({
      order,
      bankInfo,
    });
  })
);

// Sinkronisasi aktif: setiap payment MIDTRANS/DOKU yang masih PENDING dicek
// langsung ke API gateway (bukan pasif menunggu webhook). Ini bikin status
// tetap ter-update walau Notification URL belum/tidak sempat dikonfigurasi
// di dashboard Midtrans/Doku — jalan otomatis baik sandbox maupun production.
// Kegagalan cek (network/gateway error) sengaja di-diamkan supaya halaman
// status order tetap bisa tampil dari data DB yang ada.
async function syncPendingPayments(order) {
  let anyPaid = false;

  for (const payment of order.payments) {
    if (payment.status !== "PENDING") continue;

    try {
      if (payment.method === "MIDTRANS" && payment.midtransOrderId) {
        const statusResp = await coreApi.transaction.status(payment.midtransOrderId);
        const { transaction_status, fraud_status } = statusResp;
        let newStatus = payment.status;
        if (transaction_status === "capture") {
          newStatus = fraud_status === "accept" ? "PAID" : "PENDING";
        } else if (transaction_status === "settlement") {
          newStatus = "PAID";
        } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
          newStatus = transaction_status === "expire" ? "EXPIRED" : "FAILED";
        }
        if (newStatus !== payment.status) {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: newStatus, midtransRaw: statusResp } });
          if (newStatus === "PAID") anyPaid = true;
        }
      } else if (payment.method === "DOKU" && payment.dokuInvoiceNumber && isDokuConfigured()) {
        const statusResp = await checkDokuStatus(payment.dokuInvoiceNumber);
        let newStatus = payment.status;
        if (statusResp.transactionStatus === "SUCCESS") newStatus = "PAID";
        else if (statusResp.transactionStatus === "FAILED") newStatus = "FAILED";
        else if (statusResp.transactionStatus === "EXPIRED" || statusResp.orderStatus === "ORDER_EXPIRED") newStatus = "EXPIRED";
        if (newStatus !== payment.status) {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: newStatus, dokuRaw: statusResp.raw } });
          if (newStatus === "PAID") anyPaid = true;
        }
      }
    } catch (err) {
      if (!err.notFound) console.error(`[sync ${payment.method}] gagal cek status:`, err.message);
    }
  }

  if (anyPaid && order.status !== "PAID") {
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: { status: "PAID" },
      include: { service: true, payments: true },
    });
    const paidPayment = updatedOrder.payments.find((p) => p.status === "PAID");
    if (paidPayment) notifyPaymentConfirmed(updatedOrder, paidPayment, updatedOrder.service).catch(() => {});
    return updatedOrder;
  }

  if (anyPaid) {
    // order sudah PAID tapi payment record baru saja diupdate — reload biar payments-nya fresh
    return prisma.order.findUnique({ where: { id: order.id }, include: { service: true, payments: true } });
  }

  return order;
}

// GET /api/orders/:invoiceNumber — cek status order
router.get(
  "/:invoiceNumber",
  asyncHandler(async (req, res) => {
    let order = await prisma.order.findUnique({
      where: { invoiceNumber: req.params.invoiceNumber },
      include: { service: true, payments: true },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    order = await syncPendingPayments(order);

    res.json(order);
  })
);

// ===== Admin-only =====
// GET /api/orders?page=1&limit=20 — list order dengan pagination
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100; // batas atas biar gak dipakai buat narik semua data sekaligus

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        include: { service: true, payments: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count(),
    ]);

    res.json({
      orders,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

// POST /api/orders/:id/cancel (admin) — batalkan order.
// Kalau ada payment MIDTRANS berstatus PAID, coba refund otomatis lewat
// Midtrans. Kalau gagal atau metodenya BANK_TRANSFER, order tetap dibatalkan
// tapi admin perlu proses refund dananya secara manual (dicatat di response).
router.post(
  "/:id/cancel",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const parsed = cancelOrderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });
    }
    const { reason } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { service: true, payments: true },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (order.status === "CANCELLED") {
      return res.status(400).json({ error: "Order ini sudah dibatalkan sebelumnya" });
    }
    if (order.status === "COMPLETED") {
      return res.status(400).json({ error: "Order yang sudah selesai tidak bisa dibatalkan" });
    }

    const refundNotes = [];

    // Coba refund otomatis untuk payment yang sudah PAID.
    for (const payment of order.payments) {
      if (payment.status !== "PAID") continue;

      if (payment.method === "MIDTRANS") {
        try {
          const refundResult = await coreApi.transaction.refund(payment.midtransOrderId, {
            refund_key: `refund-${payment.id}-${Date.now()}`,
            amount: payment.amount,
            reason: reason || "Order dibatalkan oleh admin",
          });
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "REFUNDED", refundedAt: new Date(), refundRaw: refundResult },
          });
          refundNotes.push(`Payment ${payment.id}: refund Midtrans berhasil diajukan.`);
        } catch (err) {
          console.error("[midtrans refund] gagal:", err.message);
          refundNotes.push(
            `Payment ${payment.id}: refund otomatis via Midtrans gagal (${err.message}). Perlu diproses manual.`
          );
        }
      } else if (payment.method === "BANK_TRANSFER") {
        refundNotes.push(`Payment ${payment.id}: transfer bank manual, refund dana perlu dilakukan manual ke customer.`);
      } else if (payment.method === "DOKU") {
        // Refund otomatis via API Doku tidak diimplementasikan di sini —
        // ajukan refund manual lewat Doku Back Office atau hubungi Doku Support.
        refundNotes.push(`Payment ${payment.id}: pembayaran via Doku, refund dana perlu diajukan manual lewat Doku Back Office.`);
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelReason: reason || null,
        cancelledBy: req.admin.email,
        cancelledAt: new Date(),
      },
      include: { service: true, payments: true },
    });

    notifyOrderCancelled(updatedOrder, order.service, reason).catch(() => {});

    res.json({ order: updatedOrder, refundNotes });
  })
);

module.exports = router;
