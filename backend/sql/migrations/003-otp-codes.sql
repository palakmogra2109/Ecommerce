-- Additive one-time-passcode storage for storefront mobile login.
--
-- Codes are short-lived numeric strings stored as SHA-256 hashes (the plain
-- code only exists in transit to the SMS sender / demo response). One row
-- per issued code; verification marks the row consumed. Nothing here
-- modifies existing tables or values.
CREATE TABLE IF NOT EXISTS otp_codes (
  id           BIGSERIAL PRIMARY KEY,
  uuid         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  identifier   TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'login',
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_identifier_idx ON otp_codes(identifier);
