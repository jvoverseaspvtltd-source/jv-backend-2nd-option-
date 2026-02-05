-- Migration: Advanced Support System Features (Refined)
-- Run in Supabase SQL Editor

-- 0. Ensure UUID extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Extend employee_queries table
DO $$ 
BEGIN 
    -- Add columns if they don't exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_queries') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_queries' AND column_name='is_escalated') THEN
            ALTER TABLE employee_queries ADD COLUMN is_escalated BOOLEAN DEFAULT FALSE;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_queries' AND column_name='escalated_at') THEN
            ALTER TABLE employee_queries ADD COLUMN escalated_at TIMESTAMPTZ;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_queries' AND column_name='closed_at') THEN
            ALTER TABLE employee_queries ADD COLUMN closed_at TIMESTAMPTZ;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_queries' AND column_name='is_deleted') THEN
            ALTER TABLE employee_queries ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
        END IF;
    ELSE
        -- Fallback: Create table if missing (unlikely but safe)
        CREATE TABLE employee_queries (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            creator_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            category TEXT NOT NULL CHECK (category IN ('HR', 'IT', 'Finance', 'Management')),
            priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
            status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
            assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_message_at TIMESTAMPTZ DEFAULT NOW(),
            is_escalated BOOLEAN DEFAULT FALSE,
            escalated_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ,
            is_deleted BOOLEAN DEFAULT FALSE
        );
    END IF;
END $$;

-- 2. Extend employee_query_messages table
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_query_messages') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_query_messages' AND column_name='is_internal') THEN
            ALTER TABLE employee_query_messages ADD COLUMN is_internal BOOLEAN DEFAULT FALSE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_query_messages' AND column_name='read_at') THEN
            ALTER TABLE employee_query_messages ADD COLUMN read_at TIMESTAMPTZ;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employee_query_messages' AND column_name='attachments') THEN
            ALTER TABLE employee_query_messages ADD COLUMN attachments JSONB DEFAULT '[]';
        END IF;
    ELSE
        CREATE TABLE employee_query_messages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            query_id UUID NOT NULL REFERENCES employee_queries(id) ON DELETE CASCADE,
            sender_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            message TEXT NOT NULL,
            is_internal BOOLEAN DEFAULT FALSE,
            read_at TIMESTAMPTZ,
            attachments JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    END IF;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_queries_escalated_true ON employee_queries(is_escalated) WHERE is_escalated = TRUE;

-- 6. Enable RLS
ALTER TABLE employee_query_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_query_canned_responses ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow auth access events') THEN
        CREATE POLICY "Allow auth access events" ON employee_query_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow auth access canned') THEN
        CREATE POLICY "Allow auth access canned" ON employee_query_canned_responses FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 8. Seed some initial Canned Responses
INSERT INTO employee_query_canned_responses (title, content, category) VALUES
('Checking Issue', 'We are checking this issue and will get back to you shortly.', 'General'),
('Resolved', 'This issue has been resolved. Please verify on your end.', 'General'),
('IT Forward', 'We have forwarded this request to our IT team for technical investigation.', 'IT'),
('Need Info', 'Could you please provide more details or a screenshot of the issue?', 'General')
ON CONFLICT DO NOTHING;
