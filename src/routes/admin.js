const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../prisma");
const { requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { generateCaptcha, verifyCaptcha } = require("../services/captcha");

const router = express.Router();

// GET /api/admin/captcha — ambil soal verifikasi "bukan robot" sebelum login
router.get(
  "/captcha",
  asyncHandler(async (req, res) => {
    const { a, b, expiresAt, token } = generateCaptcha();
    res.json({ a, b, expiresAt, token });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  captcha: z.object({
    a: z.number(),
    b: z.number(),
    expiresAt: z.number(),
    token: z.string(),
    answer: z.union([z.string(), z.number()]),
  }),
});

// POST /api/admin/login
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data tidak valid" });

    const { email, password, captcha } = parsed.data;

    const captchaResult = verifyCaptcha(captcha);
    if (!captchaResult.ok) {
      return res.status(400).json({ error: captchaResult.reason, captchaFailed: true });
    }

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin) return res.status(401).json({ error: "Email atau password salah" });

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ error: "Email atau password salah" });

    const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name, role: admin.role }, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  })
);

// GET /api/admin/me — verifikasi token & ambil profil admin yang login
router.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

module.exports = router;

// ─── USER MANAGEMENT (hanya ADMIN penuh, bukan DEMO) ───────────────────────

const { requireFullAdmin } = require("../middleware/auth");

// GET /api/admin/users — daftar semua user admin
router.get(
  "/users",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const users = await prisma.adminUser.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  })
);

const createUserSchema = z.object({
  email: z.string().email("Email tidak valid"),
  name: z.string().min(1, "Nama wajib diisi"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  role: z.enum(["ADMIN", "DEMO"]).default("DEMO"),
});

// POST /api/admin/users — tambah user baru
router.post(
  "/users",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e) => e.message).join(", ");
      return res.status(400).json({ error: msg });
    }

    const { email, name, password, role } = parsed.data;

    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email sudah terdaftar" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.adminUser.create({
      data: { email, name, passwordHash, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  })
);

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8, "Password minimal 8 karakter").optional(),
  role: z.enum(["ADMIN", "DEMO"]).optional(),
});

// PUT /api/admin/users/:id — edit user (nama, email, password, role)
router.put(
  "/users/:id",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e) => e.message).join(", ");
      return res.status(400).json({ error: msg });
    }

    const { name, email, password, role } = parsed.data;
    const data = {};
    if (name) data.name = name;
    if (role) data.role = role;
    if (email) {
      const conflict = await prisma.adminUser.findFirst({
        where: { email, NOT: { id: req.params.id } },
      });
      if (conflict) return res.status(409).json({ error: "Email sudah dipakai user lain" });
      data.email = email;
    }
    if (password) data.passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.adminUser.update({
      where: { id: req.params.id },
      data,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    res.json(user);
  })
);

// DELETE /api/admin/users/:id — hapus user (tidak bisa hapus diri sendiri)
router.delete(
  "/users/:id",
  requireFullAdmin,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.admin.id) {
      return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri yang sedang aktif" });
    }
    await prisma.adminUser.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);

// POST /api/admin/change-password — ganti password diri sendiri (semua role boleh)
router.post(
  "/change-password",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Password lama dan baru wajib diisi" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password baru minimal 8 karakter" });
    }

    const user = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Password lama salah" });

    await prisma.adminUser.update({
      where: { id: req.admin.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    res.json({ ok: true });
  })
);
