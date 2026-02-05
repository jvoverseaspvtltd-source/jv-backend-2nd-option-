-- ============================================================================
-- ANNOUNCEMENT INTERACTIVITY ENHANCEMENTS
-- ============================================================================

-- 1. REACTION ENGINE
CREATE TABLE IF NOT EXISTS announcement_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL, -- The emoji character or alias
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(announcement_id, employee_id, emoji)
);

-- 2. INDEXES for fast aggregation
CREATE INDEX IF NOT EXISTS idx_reactions_announcement ON announcement_reactions(announcement_id);
CREATE INDEX IF NOT EXISTS idx_reactions_employee ON announcement_reactions(employee_id);

-- 3. ENSURE STORAGE BUCKET (Optional, usually handled via UI or script)
-- Note: Ensure 'announcements' bucket exists in Supabase Storage.
