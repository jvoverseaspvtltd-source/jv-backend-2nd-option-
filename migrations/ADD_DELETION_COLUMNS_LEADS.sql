-- Add deletion tracking columns to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create an index to improve performance on filtered queries
CREATE INDEX IF NOT EXISTS idx_leads_is_deleted ON leads(is_deleted);
