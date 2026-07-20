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

// GET /api/services/admin/all (admin) — semua paket termasuk yang nonaktif, untuk dashboard
router.get(
  "/admin/all",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      orderBy: { createdAt: "asc" },
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

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const createSchema = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1, "Nama layanan wajib diisi"),
  subtitle: z.string().min(1, "Subjudul wajib diisi"),
  domainType: z.string().min(1, "Tipe domain wajib diisi"),
  pageCount: z.number().int().positive(),
  priceOriginal: z.number().int().positive(),
  priceFinal: z.number().int().positive(),
  workingDays: z.string().min(1),
  features: z.array(z.string()).default([]),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// POST /api/services (admin) — tambah paket layanan baru
router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const data = { ...parsed.data };
    data.slug = data.slug ? slugify(data.slug) : slugify(data.name + "-" + data.domainType);

    const exists = await prisma.service.findUnique({ where: { slug: data.slug } });
    if (exists) {
      return res.status(409).json({ error: "Slug sudah dipakai paket lain, ganti nama atau slug-nya" });
    }

    const service = await prisma.service.create({ data });
    res.status(201).json(service);
  })
);

const updateSchema = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  subtitle: z.string().min(1).optional(),
  domainType: z.string().min(1).optional(),
  pageCount: z.number().int().positive().optional(),
  priceOriginal: z.number().int().positive().optional(),
  priceFinal: z.number().int().positive().optional(),
  workingDays: z.string().optional(),
  features: z.array(z.string()).optional(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// PUT /api/services/:id (admin) — ubah data lengkap paket (harga, deskripsi, fitur, status, dll)
router.put(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid", details: parsed.error.flatten() });

    const data = { ...parsed.data };
    if (data.slug) {
      data.slug = slugify(data.slug);
      const exists = await prisma.service.findUnique({ where: { slug: data.slug } });
      if (exists && exists.id !== req.params.id) {
        return res.status(409).json({ error: "Slug sudah dipakai paket lain" });
      }
    }

    const service = await prisma.service.update({
      where: { id: req.params.id },
      data,
    });
    res.json(service);
  })
);

// DELETE /api/services/:id (admin) — hapus paket layanan
router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await prisma.service.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (err) {
      if (err.code === "P2003" || err.code === "P2014") {
        return res.status(409).json({
          error: "Paket ini sudah punya order terkait dan tidak bisa dihapus. Nonaktifkan saja paketnya.",
        });
      }
      throw err;
    }
  })
);

module.exports = router;
