-- Task 3.10 (bulk sending): an invitation row is created by the send as `queued` with no token
-- yet; its job stores the token's hash just before sending, and clears it again when the email
-- clearly never left (a new token is made on the retry), so a `failed` row has none either.
-- The rule of task 1.4 is kept for every email that went out: a sent, delivered or bounced
-- invite or reminder always has its token hash; the signed copy never has one.
ALTER TABLE "email_messages" DROP CONSTRAINT "email_messages_token_hash_type_check";

ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_token_hash_type_check" CHECK (
    CASE
      WHEN "type" = 'signed_copy' THEN "token_hash" IS NULL
      ELSE "token_hash" IS NOT NULL OR "status" IN ('queued', 'failed')
    END
  );
