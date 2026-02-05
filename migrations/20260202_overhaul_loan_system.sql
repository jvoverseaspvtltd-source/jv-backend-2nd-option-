-- Expand loan_applications table for Pro-Level Loan System
ALTER TABLE loan_applications 
ADD COLUMN IF NOT EXISTS loan_type VARCHAR DEFAULT 'Education Loan',
ADD COLUMN IF NOT EXISTS applied_through VARCHAR DEFAULT 'Veda Loans & Finance',
ADD COLUMN IF NOT EXISTS branch_name VARCHAR,
ADD COLUMN IF NOT EXISTS application_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS disbursed_amount DECIMAL DEFAULT 0,
ADD COLUMN IF NOT EXISTS interest_rate DECIMAL,
ADD COLUMN IF NOT EXISTS loan_tenure INTEGER,
ADD COLUMN IF NOT EXISTS emi_amount DECIMAL,
ADD COLUMN IF NOT EXISTS co_applicant_name VARCHAR,
ADD COLUMN IF NOT EXISTS co_applicant_email VARCHAR,
ADD COLUMN IF NOT EXISTS co_applicant_phone VARCHAR,
ADD COLUMN IF NOT EXISTS relationship VARCHAR;

-- Add check constraint: Approved (Sanctioned) amount should not exceed Applied amount
-- Note: loan_amount in this schema seems to be the Applied Amount
-- ALTER TABLE loan_applications ADD CONSTRAINT check_sanction_amount CHECK (sanctioned_amount <= loan_amount);

COMMENT ON COLUMN loan_applications.loan_type IS 'Type of loan, e.g., Education Loan';
COMMENT ON COLUMN loan_applications.applied_through IS 'Partner company through which loan is applied';
COMMENT ON COLUMN loan_applications.branch_name IS 'Bank branch name';
COMMENT ON COLUMN loan_applications.application_date IS 'Date when the loan application was submitted';
COMMENT ON COLUMN loan_applications.disbursed_amount IS 'Amount actually disbursed to the student/university';
COMMENT ON COLUMN loan_applications.interest_rate IS 'Annual interest rate for the loan';
COMMENT ON COLUMN loan_applications.loan_tenure IS 'Duration of the loan in months';
COMMENT ON COLUMN loan_applications.emi_amount IS 'Equated Monthly Installment amount';
COMMENT ON COLUMN loan_applications.co_applicant_name IS 'Name of the co-applicant (usually a parent/guardian)';
