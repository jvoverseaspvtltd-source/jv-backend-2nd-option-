-- ============================================================================
-- MASTER TASK SYSTEM & SCHEMA FIXES
-- ============================================================================
-- This script fixes the "tasks relation does not exist" error and implements
-- the production-ready Task Assignment features in one go.

-- 1. FIX: ENSURE LEADS/REGISTRATIONS HAVE REQUIRED COLUMNS (Fixes 500 Error)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rejection_details JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES employees(id);

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS loan_opted BOOLEAN DEFAULT FALSE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- 2. CREATE TASKS TABLE (If missing)
CREATE TABLE IF NOT EXISTS tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES employees(id),
    status TEXT DEFAULT 'PENDING',
    priority TEXT DEFAULT 'MEDIUM',
    department_id UUID REFERENCES departments(id),
    created_by UUID REFERENCES employees(id),
    due_date TIMESTAMPTZ,
    visibility_type VARCHAR(20) DEFAULT 'INDIVIDUAL' CHECK (visibility_type IN ('GLOBAL', 'DEPARTMENT', 'INDIVIDUAL')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ENSURE NEW FIELDS EXIST (If table existed but was old)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visibility_type VARCHAR(20) DEFAULT 'INDIVIDUAL';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);

-- 4. CREATE TASK AUDIT LOGS
CREATE TABLE IF NOT EXISTS task_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- CREATED, STATUS_CHANGE, EDITED, DELETED
    performed_by UUID REFERENCES employees(id),
    old_value TEXT,
    new_value TEXT,
    metadata JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 5. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_tasks_visibility ON tasks(visibility_type);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);

-- 6. RELOAD SCHEMA CACHE (Critical for Supabase)
NOTIFY pgrst, 'reload config';

-- 7. COMMENT FOR CLARITY
COMMENT ON TABLE tasks IS 'Production-ready task management with role-based visibility';
