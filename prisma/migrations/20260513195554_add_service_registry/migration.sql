-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('online', 'offline', 'maintenance', 'unknown');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "port" INTEGER,
    "localUrl" TEXT,
    "remoteUrl" TEXT,
    "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner" TEXT,
    "gitRepo" TEXT,
    "database" TEXT,
    "status" "ServiceStatus" NOT NULL DEFAULT 'unknown',
    "version" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serviceId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'related',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");
CREATE INDEX "services_status_idx" ON "services"("status");
CREATE INDEX "services_owner_idx" ON "services"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "service_requirements_serviceId_requirementId_key" ON "service_requirements"("serviceId", "requirementId");
CREATE INDEX "service_requirements_serviceId_idx" ON "service_requirements"("serviceId");
CREATE INDEX "service_requirements_requirementId_idx" ON "service_requirements"("requirementId");

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
