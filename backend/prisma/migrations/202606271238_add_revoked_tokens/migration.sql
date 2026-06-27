-- CreateTable: RevokedToken
CREATE TABLE "revoked_tokens" (
    "id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "reason" TEXT,
    "revokedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revoked_tokens_jti_key" ON "revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "revoked_tokens_jti_idx" ON "revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "revoked_tokens_userId_idx" ON "revoked_tokens"("userId");

-- CreateIndex
CREATE INDEX "revoked_tokens_revokedAt_idx" ON "revoked_tokens"("revokedAt");
