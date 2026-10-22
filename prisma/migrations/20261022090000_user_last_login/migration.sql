-- Record future successful sign-ins without inventing a historical login date.
-- Existing sessions may have been refreshed, replaced or deleted, so they are
-- not a reliable source for backfilling a user's last successful sign-in.
ALTER TABLE "users" ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);
