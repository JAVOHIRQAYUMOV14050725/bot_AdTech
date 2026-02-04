ALTER TABLE "user_invites" ADD COLUMN "invitedUserId" TEXT;

ALTER TABLE "user_invites"
ADD CONSTRAINT "user_invites_invitedUserId_fkey"
FOREIGN KEY ("invitedUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_invites"
ADD CONSTRAINT "user_invites_invitedUserId_key" UNIQUE ("invitedUserId");
