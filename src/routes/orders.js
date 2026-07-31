const express = require("express");
const { z } = require("zod");
const midtransClient = require("midtrans-client");
const prisma = require("../prisma");
const { requireAdmin, requireFullAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getBankInfo } = require("../services/bankInfo");
const { orderCreateLimiter } = require("../middleware/rateLimit");
const { notifyOrderCancelled } = require("../services/mailer");

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
  customerName: z.string().min(2),
  customerEmail: z.string().email(),
  customerPhone: z.string().min(8),
  businessName: z.string().optional(),
  notes: z.string().optional(),
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
      return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });
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

// GET /api/orders/:invoiceNumber — cek status order
router.get(
  "/:invoiceNumber",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { invoiceNumber: req.params.invoiceNumber },
      include: { service: true, payments: true },
    });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
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
