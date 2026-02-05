-- MIGRATION: Unified Query & Chat System (Fixed Config)
-- Run this in Supabase SQL Editor

-- 1. Create `student_queries` table
CREATE TABLE IF NOT EXISTS student_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    category VARCHAR(50) CHECK (category IN ('Admission', 'Fees', 'Course', 'Technical', 'Other')),
    status VARCHAR(20) DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
    assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL, -- Fixed: References employees table
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create `query_messages` table
CREATE TABLE IF NOT EXISTS query_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_id UUID NOT NULL REFERENCES student_queries(id) ON DELETE CASCADE,
    sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('STUDENT', 'EMPLOYEE', 'SYSTEM')),
    sender_id UUID NOT NULL, -- Polymorphic ID: References either registrations.id or employees.id
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_queries_student ON student_queries(student_id);
CREATE INDEX IF NOT EXISTS idx_queries_assigned ON student_queries(assigned_to);
CREATE INDEX IF NOT EXISTS idx_queries_status ON student_queries(status);
CREATE INDEX IF NOT EXISTS idx_messages_query ON query_messages(query_id);

-- 4. Enable RLS
ALTER TABLE student_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Allow Authenticated Users (Students & Employees) to Read/Write
DROP POLICY IF EXISTS "Allow All Authenticated Access" ON student_queries;
CREATE POLICY "Allow All Authenticated Access" ON student_queries
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow All Authenticated Access Messages" ON query_messages;
CREATE POLICY "Allow All Authenticated Access Messages" ON query_messages
FOR ALL TO authenticated USING (true) WITH CHECK (true);
