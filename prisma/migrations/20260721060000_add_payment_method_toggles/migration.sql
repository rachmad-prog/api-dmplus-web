-- AlterTable
ALTER TABLE "SiteSetting" ADD COLUMN     "enableBankTransfer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enableMidtrans" BOOLEAN NOT NULL DEFAULT true;
