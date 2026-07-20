const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getBankInfo } = require("../services/bankInfo");

const router = express.Router();

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
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      include: { service: true, payments: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders);
  })
);

module.exports = router;
