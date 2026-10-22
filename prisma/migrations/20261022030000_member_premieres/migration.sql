-- Opt-in only: no historical announcement, offer or preview is changed.
ALTER TABLE "projects" ADD COLUMN "membersPreviewEnabled" BOOLEAN NOT NULL DEFAULT false;
