-- Migration: Exhaustive CRM Workflow Expansion
-- Description: Adds tables for dual-access documents, admission applications, and offer letters.

-- 1. Updated student_documents (Overwriting with new audit fields)
DROP TABLE IF EXISTS student_documents CASCADE;
CREATE TABLE student_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL, -- Logical ID from documentConfig.js
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UPLOADED', 'VERIFIED', 'REJECTED')),
    remarks TEXT,
    action_by UUID REFERENCES employees(id), -- Employee who last verified/rejected
    action_role TEXT CHECK (action_role IN ('COUNSELLOR', 'ADMISSION')),
    action_at TIMESTAMP WITH TIME ZONE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(registration_id, doc_id)
);

-- 2. Admission Applications
CREATE TABLE IF NOT EXISTS admission_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    university TEXT NOT NULL,
    course TEXT NOT NULL,
    intake TEXT,
    fees JSONB DEFAULT '{"applicationFee": 0, "tuitionFee": 0, "currency": "USD"}',
    status TEXT DEFAULT 'Applied' CHECK (status IN ('Applied', 'Under Review', 'Approved', 'Rejected')),
    assigned_to UUID REFERENCES employees(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Offer Letters
CREATE TABLE IF NOT EXISTS offer_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    application_id UUID REFERENCES admission_applications(id) ON DELETE CASCADE,
    university TEXT NOT NULL,
    status TEXT DEFAULT 'Conditional' CHECK (status IN ('Conditional', 'Confirmed')),
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (Simplified for now, as requested to implement CRM side first)
ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_letters ENABLE ROW LEVEL SECURITY;
