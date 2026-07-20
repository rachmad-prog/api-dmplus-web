const { PrismaClient } = require("@prisma/client");

// Di lingkungan serverless (Vercel), tiap invocation bisa jalan di instance
// terpisah dan (saat development lokal) nodemon suka reload modul berkali-kali.
// Pola singleton ini mencegah PrismaClient dibuat berulang-ulang yang bisa
// menghabiskan koneksi database.
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
