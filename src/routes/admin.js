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

    const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  })
);

// GET /api/admin/me — verifikasi token & ambil profil admin yang login
router.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

module.exports = router;
