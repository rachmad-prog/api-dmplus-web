const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// GET /api/services — daftar paket aktif, publik (untuk halaman harga)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: { priceFinal: "asc" },
    });
    res.json(services);
  })
);

// GET /api/services/:slug
router.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const service = await prisma.service.findUnique({ where: { slug: req.params.slug } });
    if (!service) return res.status(404).json({ error: "Paket tidak ditemukan" });
    res.json(service);
  })
);

const updateSchema = z.object({
  priceOriginal: z.number().int().positive().optional(),
  priceFinal: z.number().int().positive().optional(),
  workingDays: z.string().optional(),
  isActive: z.boolean().optional(),
});

// PUT /api/services/:id (admin) — ubah harga promo/coret & status aktif paket
router.put(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const service = await prisma.service.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(service);
  })
);

module.exports = router;
