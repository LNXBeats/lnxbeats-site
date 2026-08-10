-- V0.5.2 uses unique hashed identifiers for reset tokens and consumed
-- verification markers. Existing validated migrations remain unchanged.
DROP INDEX "auth_verifications_identifier_idx";
CREATE UNIQUE INDEX "auth_verifications_identifier_key" ON "auth_verifications"("identifier");
