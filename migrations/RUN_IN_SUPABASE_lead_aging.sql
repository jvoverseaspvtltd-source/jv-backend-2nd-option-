-- =====================================================
-- LEAD AGING SYSTEM - Database Migration
-- =====================================================
-- Run this in Supabase SQL Editor
-- Purpose: Add assigned_at timestamp for lead aging tracking
-- =====================================================

-- Step 1: Add assigned_at column
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

-- Step 2: Backfill existing leads
UPDATE leads 
SET assigned_at = created_at 
WHERE assigned_at IS NULL;

-- Step 3: Set default for future records
ALTER TABLE leads 
ALTER COLUMN assigned_at SET DEFAULT CURRENT_TIMESTAMP;

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_assigned_at ON leads(assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_date ON leads(assigned_to, assigned_at DESC);

-- Step 5: Add column comment
COMMENT ON COLUMN leads.assigned_at IS 'Timestamp when lead was assigned to counsellor/employee for lead aging tracking';

-- =====================================================
-- Verification Query
-- =====================================================
-- Run this to verify the migration worked:
-- SELECT id, name, assigned_at, created_at FROM leads LIMIT 5;
