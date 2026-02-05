-- ============================================================================
-- FIELD AGENT MODULE MIGRATION
-- ============================================================================

-- 1. ENHANCE REGISTRATIONS TABLE FOR FIELD AGENT
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS field_agent_status VARCHAR(50) DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS loan_status VARCHAR(50) DEFAULT 'NOT_STARTED', -- NOT_STARTED, IN_PROGRESS, VERIFIED, REJECTED
ADD COLUMN IF NOT EXISTS assigned_field_agent_id UUID REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS is_transferred_to_veda BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS transferred_to_veda_at TIMESTAMPTZ;

-- 2. LOAN DOCUMENTS TABLE
CREATE TABLE IF NOT EXISTS loan_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL, -- ID_PROOF, ADDRESS_PROOF, INCOME_PROOF, BANK_STATEMENTS, etc.
  document_name VARCHAR(255),
  file_url TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, UPLOADED, VERIFIED, REJECTED
  remarks TEXT,
  uploaded_by UUID REFERENCES employees(id),
  verified_by UUID REFERENCES employees(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FIELD AGENT TASKS (Specific to document collection etc.)
CREATE TABLE IF NOT EXISTS field_agent_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  registration_id UUID REFERENCES registrations(id),
  assigned_to UUID REFERENCES employees(id),
  assigned_by UUID REFERENCES employees(id),
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, CANCELLED
  priority VARCHAR(20) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, URGENT
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. UPDATE AUDIT LOGS FOR FIELD AGENT ACTIONS
-- (Audit logs are handled via the auditService in controllers)
