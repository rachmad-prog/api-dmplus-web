/*
  Warnings:

  - The values [DP_PENDING,DP_PAID,FINAL_PENDING] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `dpAmount` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `finalAmount` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `stage` on the `Payment` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('NEW', 'PENDING', 'PAID', 'COMPLETED', 'CANCELLED');
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'NEW';
COMMIT;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "dpAmount",
DROP COLUMN "finalAmount";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "stage";

-- DropEnum
DROP TYPE "PaymentStage";
