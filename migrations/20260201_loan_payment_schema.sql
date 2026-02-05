-- Add columns to loan_applications
ALTER TABLE loan_applications 
ADD COLUMN IF NOT EXISTS processing_fee DECIMAL DEFAULT 57000,
ADD COLUMN IF NOT EXISTS total_paid DECIMAL DEFAULT 0,
ADD COLUMN IF NOT EXISTS loan_disbursement_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS sanctioned_amount DECIMAL,
ADD COLUMN IF NOT EXISTS partner_company TEXT;

-- Create loan_payments table
CREATE TABLE IF NOT EXISTS loan_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    loan_id UUID REFERENCES loan_applications(id) ON DELETE CASCADE,
    amount DECIMAL NOT NULL,
    payment_date TIMESTAMP DEFAULT NOW(),
    notes TEXT NOT NULL,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Enable RLS (Optional, policies can be added later if needed)
ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;

-- NOTE: RLS Policies are skipped for now to avoid dependency errors.
-- Access control is handled by the backend endpoints.

-- 4. Students can view their own loan payments (via loan_id link)

