CREATE TABLE "auth_registration_attempts" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "codeHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "continuationHash" VARCHAR(128),
    "continuationExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_registration_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_registration_attempts_email_createdAt_idx"
ON "auth_registration_attempts"("email", "createdAt");

CREATE INDEX "auth_registration_attempts_expiresAt_idx"
ON "auth_registration_attempts"("expiresAt");

CREATE INDEX "auth_registration_attempts_continuationExpiresAt_idx"
ON "auth_registration_attempts"("continuationExpiresAt");
