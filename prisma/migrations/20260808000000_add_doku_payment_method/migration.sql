-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'DOKU';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "dokuInvoiceNumber" TEXT,
ADD COLUMN     "dokuPaymentUrl" TEXT,
ADD COLUMN     "dokuRaw" JSONB;

-- AlterTable
ALTER TABLE "SiteSetting" ADD COLUMN     "enableDoku" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_dokuInvoiceNumber_key" ON "Payment"("dokuInvoiceNumber");
