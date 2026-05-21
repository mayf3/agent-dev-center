-- CreateTable: Postmortems
CREATE TABLE "postmortems" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirementId" UUID,
    "title" TEXT NOT NULL,
    "phenomenon" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "whyExistingProcess" TEXT NOT NULL,
    "longTermPrinciple" TEXT NOT NULL,
    "preventionMeasures" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postmortems_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
