-- Migration: Add completion tracking to registrations

-- Add columns for Admission Completion
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS is_admission_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS admission_completed_by UUID REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS admission_completed_at TIMESTAMP WITH TIME ZONE;

-- Add columns for Loan Completion
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS is_loan_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS loan_completed_by UUID REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS loan_completed_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for performance on the Success Registry page
CREATE INDEX IF NOT EXISTS idx_registrations_completion_status 
ON registrations (is_admission_completed, is_loan_completed);

COMMENT ON COLUMN registrations.is_admission_completed IS 'Flag set by Admission department when their part is done';
COMMENT ON COLUMN registrations.is_loan_completed IS 'Flag set by Loan department when their part is done';
