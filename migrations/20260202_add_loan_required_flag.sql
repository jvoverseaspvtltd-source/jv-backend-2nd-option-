-- Add Loan Required flag
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS loan_required BOOLEAN DEFAULT true;

-- Update index for Success Registry performance
CREATE INDEX IF NOT EXISTS idx_registrations_completion_refined 
ON registrations (is_admission_completed, loan_required, is_loan_completed) 
WHERE is_deleted = false;

COMMENT ON COLUMN registrations.loan_required IS 'Boolean flag indicating if the student requires a loan. Default is true.';
