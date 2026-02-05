-- Migration: Advanced Support System Features
-- Run in Supabase SQL Editor

-- 1. Extend employee_queries table
ALTER TABLE employee_queries 
ADD COLUMN IF NOT EXISTS is_escalated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- 2. Extend employee_query_messages table
ALTER TABLE employee_query_messages 
ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- 3. Create Ticket Events Table (for Unified Timeline)
CREATE TABLE IF NOT EXISTS employee_query_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_id UUID NOT NULL REFERENCES employee_queries(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- 'STATUS_CHANGE', 'ASSIGNMENT', 'ESCALATION', 'INTERNAL_NOTE', 'CLOSED'
    event_data JSONB DEFAULT '{}', -- e.g. { "from": "Open", "to": "In Progress" }
    actor_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Canned Responses Table
CREATE TABLE IF NOT EXISTS employee_query_canned_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50), -- 'HR', 'IT', 'Finance', 'General'
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_query_events_query ON employee_query_events(query_id);
CREATE INDEX IF NOT EXISTS idx_queries_escalated ON employee_queries(is_escalated) WHERE is_escalated = TRUE;

-- 6. Enable RLS
ALTER TABLE employee_query_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_query_canned_responses ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
DROP POLICY IF EXISTS "Allow authenticated access events" ON employee_query_events;
CREATE POLICY "Allow authenticated access events" ON employee_query_events
FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated access canned" ON employee_query_canned_responses;
CREATE POLICY "Allow authenticated access canned" ON employee_query_canned_responses
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. Seed some initial Canned Responses
INSERT INTO employee_query_canned_responses (title, content, category) VALUES
('Checking Issue', 'We are checking this issue and will get back to you shortly.', 'General'),
('Resolved', 'This issue has been resolved. Please verify on your end.', 'General'),
('IT Forward', 'We have forwarded this request to our IT team for technical investigation.', 'IT'),
('Need Info', 'Could you please provide more details or a screenshot of the issue?', 'General')
ON CONFLICT DO NOTHING;
