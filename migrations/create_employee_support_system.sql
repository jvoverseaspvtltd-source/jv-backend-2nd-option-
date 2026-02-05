-- Migration: Create Internal Employee Support System Tables

-- 1. Create Employee Queries Table
CREATE TABLE IF NOT EXISTS employee_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('HR', 'IT', 'Finance', 'Management')),
    priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
    assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. Create Employee Query Messages Table
CREATE TABLE IF NOT EXISTS employee_query_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_id UUID NOT NULL REFERENCES employee_queries(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 3. Add Indexes for performance
CREATE INDEX IF NOT EXISTS idx_employee_queries_creator ON employee_queries(creator_id);
CREATE INDEX IF NOT EXISTS idx_employee_queries_assigned ON employee_queries(assigned_to);
CREATE INDEX IF NOT EXISTS idx_employee_queries_status ON employee_queries(status);
CREATE INDEX IF NOT EXISTS idx_employee_queries_category ON employee_queries(category);
CREATE INDEX IF NOT EXISTS idx_employee_query_messages_query ON employee_query_messages(query_id);

-- 4. Enable RLS (Optional, but good practice if using Supabase directly)
ALTER TABLE employee_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_query_messages ENABLE ROW LEVEL SECURITY;
