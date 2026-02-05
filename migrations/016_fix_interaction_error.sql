-- Migration: Fix 500 error on interaction submit
-- Purpose: Add missing rejection_details column and refresh schema cache

-- 1. Add rejection_details to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS rejection_details JSONB;

-- 2. Ensure other likely missing columns mentioned in logs exist
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES employees(id);

ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS loan_opted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- 3. FORCE SCHEMA CACHE RELOAD
-- This is the most common reason for "column not found" even if it was added
NOTIFY pgrst, 'reload config';

COMMENT ON COLUMN leads.rejection_details IS 'JSON object containing reason, rejectedBy and timestamp';
