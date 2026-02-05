-- ============================================================================
-- COMPLETE ADMISSION ENHANCEMENT MIGRATION
-- Run this ENTIRE file in your database to fix all errors
-- ============================================================================

-- Add ALL missing columns to admission_applications table
ALTER TABLE admission_applications
ADD COLUMN IF NOT EXISTS program_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS course_duration VARCHAR(100),
ADD COLUMN IF NOT EXISTS tuition_fee NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS tuition_fee_currency VARCHAR(10) DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS fees_structure TEXT,
ADD COLUMN IF NOT EXISTS mode_of_attendance VARCHAR(50),
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS campus_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS campus_address TEXT,
ADD COLUMN IF NOT EXISTS offer_letter_url TEXT,
ADD COLUMN IF NOT EXISTS additional_doc_url TEXT,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS admission_notes TEXT;

-- Add helpful comments
COMMENT ON COLUMN admission_applications.offer_letter_url IS 'URL to the uploaded Offer Letter PDF';
COMMENT ON COLUMN admission_applications.rejection_reason IS 'Mandatory reason if status is REJECTED or WITHDRAWN';
COMMENT ON COLUMN admission_applications.tuition_fee_currency IS 'Currency code for tuition fee (USD, AED, INR, GBP, EUR, CAD, AUD, CNY, JPY, SGD, NZD, MYR, THB, ZAR, CHF)';

-- Verify all columns were added successfully
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'admission_applications' 
AND column_name IN (
    'program_name', 'course_duration', 'tuition_fee', 'tuition_fee_currency',
    'fees_structure', 'mode_of_attendance', 'start_date', 'campus_name',
    'campus_address', 'offer_letter_url', 'additional_doc_url',
    'rejection_reason', 'admission_notes'
)
ORDER BY column_name;
