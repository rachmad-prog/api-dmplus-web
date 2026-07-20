const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

async function getOrCreate() {
  let row = await prisma.bankSetting.findFirst();
  if (!row) {
    // Fallback awal dari .env kalau tabel masih kosong (biar transisi mulus)
    row = await prisma.bankSetting.create({
      data: {
        bankName: process.env.BANK_NAME || null,
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || null,
        accountHolder: process.env.BANK_ACCOUNT_HOLDER || null,
      },
    });
  }
  return row;
}

// GET /api/bank-settings (admin) — dipakai dashboard admin untuk menampilkan form
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await getOrCreate();
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
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const row = await getOrCreate();
    const updated = await prisma.bankSetting.update({
      where: { id: row.id },
      data: parsed.data,
    });
    res.json(updated);
  })
);

module.exports = router;
