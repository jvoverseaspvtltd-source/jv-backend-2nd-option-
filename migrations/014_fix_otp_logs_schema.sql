-- ============================================================================
-- FIX OTP_LOGS TABLE SCHEMA
-- Add 'type' column to differentiate between creation and reset OTPs
-- ============================================================================

DO $$
BEGIN
    -- Add 'type' column to otp_logs
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'otp_logs' AND column_name = 'type') THEN
        ALTER TABLE otp_logs ADD COLUMN type VARCHAR(30) DEFAULT 'LOGIN';
    END IF;

    -- Add 'attempts' column if missing (used for lockout logic)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'otp_logs' AND column_name = 'attempts') THEN
        ALTER TABLE otp_logs ADD COLUMN attempts INTEGER DEFAULT 0;
    END IF;

    -- Add 'is_verified' column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'otp_logs' AND column_name = 'is_verified') THEN
        ALTER TABLE otp_logs ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
