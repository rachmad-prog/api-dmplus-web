const express = require("express");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin, requireFullAdmin } = require("../middleware/auth");
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
  enableBankTransfer: z.boolean().optional(),
  enableMidtrans: z.boolean().optional(),
});

// PUT /api/site-settings (admin) — ubah mode pricing card & kontrol metode
// pembayaran (transfer manual / midtrans) dari dashboard admin
router.put(
  "/",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const row = await getOrCreate();

    // Cegah kedua metode pembayaran dinonaktifkan sekaligus — minimal
    // satu metode harus tetap aktif agar customer masih bisa checkout.
    const nextBankTransfer = parsed.data.enableBankTransfer ?? row.enableBankTransfer;
    const nextMidtrans = parsed.data.enableMidtrans ?? row.enableMidtrans;
    if (!nextBankTransfer && !nextMidtrans) {
      return res.status(400).json({
        error: "Minimal satu metode pembayaran (Transfer Bank Manual atau Midtrans) harus tetap aktif",
      });
    }

    const updated = await prisma.siteSetting.update({
      where: { id: row.id },
      data: parsed.data,
    });
    res.json(updated);
  })
);

module.exports = router;
