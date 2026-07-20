-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL,
    "pricingMode" TEXT NOT NULL DEFAULT 'PAYMENT_GATEWAY',
    "ctwaWhatsapp" TEXT,
    "ctwaMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);
