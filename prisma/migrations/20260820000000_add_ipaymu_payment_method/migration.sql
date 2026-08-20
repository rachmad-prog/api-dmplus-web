-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'IPAYMU';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "ipaymuReferenceId" TEXT,
ADD COLUMN     "ipaymuSessionId" TEXT,
ADD COLUMN     "ipaymuPaymentUrl" TEXT,
ADD COLUMN     "ipaymuRaw" JSONB;

-- AlterTable
ALTER TABLE "SiteSetting" ADD COLUMN     "enableIpaymu" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_ipaymuReferenceId_key" ON "Payment"("ipaymuReferenceId");
