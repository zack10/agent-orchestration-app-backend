-- AlterTable
ALTER TABLE "Execution" ADD COLUMN "leaseUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Execution_status_leaseUntil_idx" ON "Execution"("status", "leaseUntil");
