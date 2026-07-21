const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin, requireFullAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getBankInfo } = require("../services/bankInfo");

const router = express.Router();

async function getOrCreateRow() {
  // Pastikan baris di database sudah ada (auto-seed dari env kalau masih kosong),
  // lalu kembalikan row aslinya (butuh "id" untuk update).
  await getBankInfo();
  return prisma.bankSetting.findFirst();
}

// GET /api/bank-settings (admin) — dipakai dashboard admin untuk menampilkan form
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await getOrCreateRow();
    res.json(row);
  })
);

const updateSchema = z.object({
  bankName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  accountHolder: z.string().optional().nullable(),
});

// PUT /api/bank-settings (admin) — update no rekening dari dashboard admin
router.put(
  "/",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const row = await getOrCreateRow();
    const updated = await prisma.bankSetting.update({
      where: { id: row.id },
      data: parsed.data,
    });
    res.json(updated);
  })
);

module.exports = router;
