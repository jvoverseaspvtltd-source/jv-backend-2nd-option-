-- ============================================================================
-- ENTERPRISE ANNOUNCEMENT & NEWSLETTER SYSTEM
-- ============================================================================

-- 1. CORE ANNOUNCEMENTS TABLE
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    summary TEXT, -- Short preview for feeds
    content TEXT NOT NULL, -- Rich HTML content
    type VARCHAR(50) DEFAULT 'GENERAL', -- NEWS, POLICY, UPDATE, CELEBRATION, NEWSLETTER
    priority VARCHAR(20) DEFAULT 'NORMAL', -- NORMAL, HIGH, CRITICAL
    
    -- Targeting Rules
    target_all BOOLEAN DEFAULT TRUE,
    target_departments UUID[] DEFAULT '{}', -- Array of Dept IDs
    target_roles VARCHAR(50)[] DEFAULT '{}', -- Array of Roles
    
    -- Lifecycle Management
    is_published BOOLEAN DEFAULT FALSE,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    created_by UUID REFERENCES employees(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. READ TRACKING & ACKNOWLEDGEMENT
CREATE TABLE IF NOT EXISTS announcement_engagements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT TRUE,
    read_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    UNIQUE(announcement_id, employee_id)
);

-- 3. ANNOUNCEMENT AUDIT LOGS
CREATE TABLE IF NOT EXISTS announcement_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- CREATED, PUBLISHED, EDITED, ARCHIVED, PINNED
    performed_by UUID REFERENCES employees(id),
    old_value JSONB,
    new_value JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled ON announcements(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements(is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_engagements_employee ON announcement_engagements(employee_id);

-- 5. TRIGGER FOR UPDATED_AT
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_announcements_updated_at
    BEFORE UPDATE ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comment for clarity
COMMENT ON TABLE announcements IS 'Enterprise-grade targeted internal communications';
