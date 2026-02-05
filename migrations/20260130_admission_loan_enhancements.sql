# Admission & Loan Enhancements SQL

```sql
-- 1. ENHANCE student_documents FOR DUAL AUDIT
ALTER TABLE student_documents 
ADD COLUMN IF NOT EXISTS c_status TEXT DEFAULT 'PENDING' CHECK (c_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
ADD COLUMN IF NOT EXISTS c_remarks TEXT,
ADD COLUMN IF NOT EXISTS c_by UUID REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS c_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS a_status TEXT DEFAULT 'PENDING' CHECK (a_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
ADD COLUMN IF NOT EXISTS a_remarks TEXT,
ADD COLUMN IF NOT EXISTS a_by UUID REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS a_at TIMESTAMP WITH TIME ZONE;

-- Sync existing status to a_status for historical data
UPDATE student_documents SET a_status = status, a_remarks = remarks, a_by = action_by, a_at = action_at WHERE a_status = 'PENDING' AND status != 'PENDING';

-- 2. LOAN APPLICATIONS TABLE
CREATE TABLE IF NOT EXISTS loan_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES employees(id), -- Admin who manages this
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'IN_REVIEW', 'APPROVED', 'DISBURSED', 'REJECTED')),
    loan_amount DECIMAL(15, 2),
    bank_name TEXT,
    form_data JSONB DEFAULT '{}', -- exhaustive fields from Loan Form
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(registration_id)
);

-- Enable RLS
ALTER TABLE loan_applications ENABLE ROW LEVEL SECURITY;
```
