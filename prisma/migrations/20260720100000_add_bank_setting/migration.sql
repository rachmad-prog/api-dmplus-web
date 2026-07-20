-- CreateTable
CREATE TABLE "BankSetting" (
    "id" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountHolder" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankSetting_pkey" PRIMARY KEY ("id")
);
