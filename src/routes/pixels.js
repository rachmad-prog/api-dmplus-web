const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin, requireFullAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

async function getOrCreate() {
  let row = await prisma.pixelSetting.findFirst();
  if (!row) {
    row = await prisma.pixelSetting.create({ data: {} });
  }
  return row;
}

// GET /api/pixels — publik, dipanggil frontend saat load untuk inject script tracking
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const row = await getOrCreate();
    res.json(row);
  })
);

const updateSchema = z.object({
  metaPixelId: z.string().optional().nullable(),
  googleAdsId: z.string().optional().nullable(),
  googleAdsLabel: z.string().optional().nullable(),
  tiktokPixelId: z.string().optional().nullable(),
  gtmContainerId: z.string().optional().nullable(),
});

// PUT /api/pixels (admin) — update ID pixel Meta/Google/TikTok dari dashboard admin
router.put(
  "/",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const row = await getOrCreate();
    const updated = await prisma.pixelSetting.update({
      where: { id: row.id },
      data: parsed.data,
    });
    res.json(updated);
  })
);

module.exports = router;
