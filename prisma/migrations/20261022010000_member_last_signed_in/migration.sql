-- Additive only. No backfill: old profile updates/session refreshes are not
-- evidence of a successful authentication. Existing history remains unknown.
ALTER TABLE "users" ADD COLUMN "lastSignedInAt" TIMESTAMPTZ(3);
