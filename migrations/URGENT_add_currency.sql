-- ============================================================================
-- CRITICAL MIGRATION: Add Currency Support to Tuition Fee
-- This migration MUST be run before the application creation feature will work
-- ============================================================================

-- Add the currency column
ALTER TABLE admission_applications
ADD COLUMN IF NOT EXISTS tuition_fee_currency VARCHAR(10) DEFAULT 'USD';

-- Add helpful comment
COMMENT ON COLUMN admission_applications.tuition_fee_currency IS 'Currency code for tuition fee (USD, AED, INR, GBP, EUR, CAD, AUD, etc.)';

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'admission_applications' 
AND column_name = 'tuition_fee_currency';
