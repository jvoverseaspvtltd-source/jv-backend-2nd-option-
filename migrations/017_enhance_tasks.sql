-- Migration: Enhance Tasks Module
-- Purpose: Support role-based visibility, department assignments, and audit logging

-- 1. ENHANCE TASKS TABLE
-- Use ALTER TABLE to add missing columns to the existing tasks table
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS visibility_type VARCHAR(20) DEFAULT 'INDIVIDUAL' CHECK (visibility_type IN ('GLOBAL', 'DEPARTMENT', 'INDIVIDUAL')),
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure status has allowed values
-- Note: PostgreSQL doesn't allow adding values to existing check constraints easily, 
-- but we can handle this via backend logic or by dropping/re-creating the constraint if it exists.
-- For now, we assume standard status column which we will manage.

-- 2. CREATE TASK AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS task_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- CREATED, ASSIGNED, STATUS_CHANGE, EDITED, DELETED
    performed_by UUID REFERENCES employees(id),
    old_value TEXT,
    new_value TEXT,
    metadata JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_tasks_visibility ON tasks(visibility_type);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_task_audit_task_id ON task_audit_logs(task_id);

-- 4. VIEW FOR RECAP (Optional but helpful for admin)
CREATE OR REPLACE VIEW task_summary AS
SELECT 
    t.id,
    t.title,
    t.status,
    t.priority,
    t.visibility_type,
    t.due_date,
    e.name as assigned_to_name,
    d.name as department_name,
    creator.name as created_by_name,
    t.created_at
FROM tasks t
LEFT JOIN employees e ON t.assigned_to = e.id
LEFT JOIN departments d ON t.department_id = d.id
LEFT JOIN employees creator ON t.created_by = creator.id;

-- 5. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload config';
