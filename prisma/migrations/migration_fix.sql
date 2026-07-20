-- ============================================================
-- Migration: remove DP/FINAL stage, simplify to full payment
-- Step 1: Update data existing agar tidak pakai enum lama
-- ============================================================

-- Normalkan semua status order lama ke status baru yang setara
UPDATE "Order" SET "status" = 'NEW'       WHERE "status" = 'NEW';
UPDATE "Order" SET "status" = 'PENDING'   WHERE "status" IN ('DP_PENDING', 'FINAL_PENDING');
UPDATE "Order" SET "status" = 'PAID'      WHERE "status" = 'DP_PAID';
-- COMPLETED dan CANCELLED tidak berubah

-- Step 2: Ganti tipe kolom status ke TEXT sementara (agar enum lama bisa di-drop)
ALTER TABLE "Order" ALTER COLUMN "status" TYPE TEXT;

-- Step 3: Drop enum lama dan buat enum baru
DROP TYPE "OrderStatus";
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PENDING', 'PAID', 'COMPLETED', 'CANCELLED');

-- Step 4: Kembalikan kolom status ke enum baru
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus" USING "status"::"OrderStatus";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- Step 5: Drop kolom dpAmount dan finalAmount
ALTER TABLE "Order" DROP COLUMN "dpAmount";
ALTER TABLE "Order" DROP COLUMN "finalAmount";

-- Step 6: Drop kolom stage dari Payment (ganti ke TEXT dulu agar enum bisa di-drop)
ALTER TABLE "Payment" ALTER COLUMN "stage" TYPE TEXT;
DROP TYPE "PaymentStage";
ALTER TABLE "Payment" DROP COLUMN "stage";
