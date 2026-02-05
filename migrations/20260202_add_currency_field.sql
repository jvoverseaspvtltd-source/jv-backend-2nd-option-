-- Add currency field for tuition fee
ALTER TABLE admission_applications
ADD COLUMN IF NOT EXISTS tuition_fee_currency VARCHAR(10) DEFAULT 'USD';

COMMENT ON COLUMN admission_applications.tuition_fee_currency IS 'Currency code for tuition fee (USD, AED, INR, GBP, EUR, CAD, AUD, etc.)';
