-- Optional survey only. Never changes an offer, right, price or publication.
CREATE TABLE "member_premiere_votes" (
  "projectId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "binding" CHAR(64) NOT NULL,
  "choice" VARCHAR(4),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "member_premiere_votes_pkey" PRIMARY KEY ("projectId", "userId", "binding"),
  CONSTRAINT "member_premiere_votes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_premiere_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_premiere_votes_choice_check" CHECK ("choice" IN ('UP','DOWN')),
  CONSTRAINT "member_premiere_votes_binding_check" CHECK ("binding" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "member_premiere_votes_projectId_binding_choice_idx" ON "member_premiere_votes"("projectId", "binding", "choice");
