require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("./prisma");

async function main() {
  // ===== 3 Paket Layanan =====
  const services = [
    {
      slug: "landing-page",
      name: "Landing Page",
      subtitle: "1 Halaman · domain .com",
      domainType: ".com",
      pageCount: 1,
      priceOriginal: 1301800,
      priceFinal: 953930,
      workingDays: "4 hari kerja",
      isPopular: false,
      features: [
        "Domain .com + hosting 1 tahun",
        "1 email bisnis",
        "Website 1 halaman",
        "Tracking GA4/GTM",
        "Revisi 1x",
        "Gratis 12x editing minor/tahun",
      ],
    },
    {
      slug: "company-profile-com",
      name: "Website 5 Halaman",
      subtitle: "Company Profile · domain .com",
      domainType: ".com",
      pageCount: 5,
      priceOriginal: 5325750,
      priceFinal: 1565900,
      workingDays: "7 hari kerja",
      isPopular: true,
      features: [
        "Domain .com + hosting 1 tahun",
        "1 email bisnis",
        "Website 5 halaman (company profile)",
        "Tracking GA4/GTM",
        "Revisi 1x",
        "Gratis 12x editing minor/tahun",
      ],
    },
    {
      slug: "company-profile-coid",
      name: "Website 5 Halaman",
      subtitle: "Company Profile · domain .co.id",
      domainType: ".co.id",
      pageCount: 5,
      priceOriginal: 6001750,
      priceFinal: 1865900,
      workingDays: "7 hari kerja",
      isPopular: false,
      features: [
        "Domain .co.id (badan usaha berbadan hukum)",
        "Hosting 1 tahun + 1 email bisnis",
        "Website 5 halaman (company profile)",
        "Tracking GA4/GTM",
        "Revisi 1x",
        "Gratis 12x editing minor/tahun",
      ],
    },
  ];

  for (const svc of services) {
    await prisma.service.upsert({
      where: { slug: svc.slug },
      update: svc,
      create: svc,
    });
  }
  console.log("✔ Paket layanan (3x) berhasil di-seed");

  // ===== Pixel settings default (kosong, diisi lewat dashboard admin) =====
  const existingPixel = await prisma.pixelSetting.findFirst();
  if (!existingPixel) {
    await prisma.pixelSetting.create({ data: {} });
    console.log("✔ Pixel settings default dibuat");
  }

  // ===== Admin user default =====
  const adminEmail = "admin@dmplus.id";
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email: adminEmail },
  });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("Admin123!", 10);
    await prisma.adminUser.create({
      data: { email: adminEmail, passwordHash, name: "Admin DM Plus" },
    });
    console.log(
      `✔ Admin dibuat -> email: ${adminEmail} / password: Admin123! (SEGERA GANTI!)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
