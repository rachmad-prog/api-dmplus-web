const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

async function getOrCreate() {
  let row = await prisma.siteSetting.findFirst();
  if (!row) {
    row = await prisma.siteSetting.create({ data: {} });
  }
  return row;
}

// GET /api/site-settings — publik, dipanggil halaman depan untuk tahu mode pricing
// card mana yang harus ditampilkan (payment gateway atau CTWA).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const row = await getOrCreate();
    res.json(row);
  })
);

const updateSchema = z.object({
  pricingMode: z.enum(["PAYMENT_GATEWAY", "CTWA"]).optional(),
  ctwaWhatsapp: z.string().optional().nullable(),
  ctwaMessage: z.string().optional().nullable(),
});

// PUT /api/site-settings (admin) — ubah mode pricing card dari dashboard admin
router.put(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const row = await getOrCreate();
    const updated = await prisma.siteSetting.update({
      where: { id: row.id },
      data: parsed.data,
    });
    res.json(updated);
  })
);

module.exports = router;
