-- ============================================================================
-- LEADS MODULE OVERHAUL MIGRATION
-- ============================================================================

-- 1. ENHANCE LEADS TABLE
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS father_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS qualification VARCHAR(255),
ADD COLUMN IF NOT EXISTS district VARCHAR(100),
ADD COLUMN IF NOT EXISTS state VARCHAR(100),
ADD COLUMN IF NOT EXISTS pincode VARCHAR(20),
ADD COLUMN IF NOT EXISTS gender VARCHAR(50),
ADD COLUMN IF NOT EXISTS category VARCHAR(100),
ADD COLUMN IF NOT EXISTS source_type VARCHAR(100) DEFAULT 'Own Lead',
ADD COLUMN IF NOT EXISTS lead_id_ref VARCHAR(50) UNIQUE,
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES employees(id);

-- 2. CREATE LEAD AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS lead_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- ADD, EDIT, ASSIGN
    performed_by UUID REFERENCES employees(id),
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FUNCTION TO GENERATE LEAD REFERENCE ID
-- Format: LD-YYYY-XXXXX
CREATE OR REPLACE FUNCTION generate_lead_ref_id() 
RETURNS TRIGGER AS $$
DECLARE
    year_str TEXT;
    seq_num INTEGER;
BEGIN
    year_str := to_char(CURRENT_DATE, 'YYYY');
    SELECT count(*) + 1 INTO seq_num FROM leads;
    NEW.lead_id_ref := 'LD-' || year_str || '-' || LPAD(seq_num::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. TRIGGER FOR LEAD REFERENCE ID
DROP TRIGGER IF EXISTS trg_generate_lead_ref_id ON leads;
CREATE TRIGGER trg_generate_lead_ref_id
BEFORE INSERT ON leads
FOR EACH ROW
WHEN (NEW.lead_id_ref IS NULL)
EXECUTE FUNCTION generate_lead_ref_id();

-- 5. COMMENT FOR CLARITY
COMMENT ON COLUMN leads.source_type IS 'Options: Own Lead, Student Referral, Other Department Employee, Relation Lead';
