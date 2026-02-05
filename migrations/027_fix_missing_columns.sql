-- ============================================================================
-- FIX MISSING COLUMNS IN REGISTRATIONS
-- ============================================================================

ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admission_status VARCHAR(50) DEFAULT 'PENDING';

-- Ensure study_materials has is_deleted for future use (standardizing)
ALTER TABLE study_materials
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Ensure roles exist for testing trash if needed
-- (Assuming roles like 'ADMISSION_ADMIN', 'WFH_ADMIN' are coded correctly in the app)
