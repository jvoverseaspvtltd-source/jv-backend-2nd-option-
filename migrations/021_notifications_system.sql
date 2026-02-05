-- ============================================================================
-- GLOBAL NOTIFICATION SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'GENERAL', -- TASK, SYSTEM, MESSAGE, LEAD
    priority VARCHAR(20) DEFAULT 'NORMAL', -- LOW, NORMAL, HIGH, URGENT
    link TEXT, -- Optional link to the resource (e.g. /tasks/123)
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optimized indexes for fast user fetching & unread status filtering
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_composite_read ON notifications(recipient_id, is_read);

-- Comment for clarity
COMMENT ON TABLE notifications IS 'Unified notification system for all modules';
