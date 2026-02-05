-- Migration: Add assigned_at timestamp to track lead aging
-- Purpose: Enable smart lead priority system based on assignment date

-- Add assigned_at column to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

-- Backfill existing leads with created_at as assigned_at
UPDATE leads 
SET assigned_at = created_at 
WHERE assigned_at IS NULL;

-- Set default for future records
ALTER TABLE leads 
ALTER COLUMN assigned_at SET DEFAULT CURRENT_TIMESTAMP;

-- Create index for efficient sorting by age
CREATE INDEX IF NOT EXISTS idx_leads_assigned_at ON leads(assigned_at DESC);

-- Create index for counsellor queries (assigned_to + assigned_at)
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_date ON leads(assigned_to, assigned_at DESC);

COMMENT ON COLUMN leads.assigned_at IS 'Timestamp when lead was assigned to counsellor/employee for lead aging tracking';
