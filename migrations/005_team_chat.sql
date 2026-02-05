-- ============================================================================
-- TEAM CHAT SYSTEM MIGRATION
-- ============================================================================

-- Create team_messages table
CREATE TABLE IF NOT EXISTS team_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content TEXT NOT NULL,
    sender_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT FALSE,
    attachment_url TEXT
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_team_messages_dept ON team_messages(department_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_created ON team_messages(created_at);

-- Enable Realtime for this table (Indempotent check)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'team_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
    END IF;
END $$;

-- Disable RLS (Security is handled by our Backend 'auth' middleware)
ALTER TABLE team_messages DISABLE ROW LEVEL SECURITY;
