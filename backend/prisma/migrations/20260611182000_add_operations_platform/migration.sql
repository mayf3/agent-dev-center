CREATE TYPE "CustomerStatus" AS ENUM ('active', 'inactive', 'lead', 'churned');
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "RevenueType" AS ENUM ('one_time', 'recurring', 'refund');

CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "source" TEXT,
  "status" "CustomerStatus" NOT NULL DEFAULT 'lead',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "agentId" UUID,
  "serviceType" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'pending',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revenue_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "agentId" UUID,
  "amount" DECIMAL(10,2) NOT NULL,
  "type" "RevenueType" NOT NULL DEFAULT 'one_time',
  "month" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "revenue_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customers_status_idx" ON "customers"("status");
CREATE INDEX "customers_source_idx" ON "customers"("source");
CREATE INDEX "customers_createdAt_idx" ON "customers"("createdAt");

CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");
CREATE INDEX "orders_agentId_idx" ON "orders"("agentId");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_serviceType_idx" ON "orders"("serviceType");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

CREATE INDEX "revenue_records_orderId_idx" ON "revenue_records"("orderId");
CREATE INDEX "revenue_records_agentId_idx" ON "revenue_records"("agentId");
CREATE INDEX "revenue_records_type_idx" ON "revenue_records"("type");
CREATE INDEX "revenue_records_month_idx" ON "revenue_records"("month");
CREATE INDEX "revenue_records_createdAt_idx" ON "revenue_records"("createdAt");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "revenue_records"
  ADD CONSTRAINT "revenue_records_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
