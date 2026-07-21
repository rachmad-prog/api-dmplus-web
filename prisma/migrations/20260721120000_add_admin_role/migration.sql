-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'DEMO');

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'ADMIN';
