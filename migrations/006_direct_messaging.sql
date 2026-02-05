-- ============================================================================
-- DIRECT MESSAGING (1-to-1) SYSTEM MIGRATION
-- ============================================================================

-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_one UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    participant_two UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure uniqueness between any two participants regardless of order
    CONSTRAINT unique_participants UNIQUE (participant_one, participant_two)
);

-- Create direct_messages table
CREATE TABLE IF NOT EXISTS direct_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    attachment_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'sent', -- sent, delivered, read
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_dm_created ON direct_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conv_p1 ON conversations(participant_one);
CREATE INDEX IF NOT EXISTS idx_conv_p2 ON conversations(participant_two);

-- Enable Realtime for these tables
DO $$
BEGIN
    -- Realtime for conversations
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
    END IF;

    -- Realtime for direct_messages
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'direct_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;
    END IF;
END $$;

-- Disable RLS (Security handled by backend)
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages DISABLE ROW LEVEL SECURITY;
