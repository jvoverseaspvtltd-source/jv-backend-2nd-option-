-- ============================================================================
-- REMOVE FIELD AGENT MODULE
-- This script safely removes all Field Agent related tables, columns, and data
-- Run this in the Supabase SQL Editor
-- ============================================================================

-- IMPORTANT: Backup your database before running this script!

DO $$
DECLARE
    deleted_audit_logs INT;
    deleted_refresh_tokens INT;
    deleted_otp_logs INT;
    deleted_employees INT;
    deleted_roles INT;
    deleted_department INT;
    field_dept_id UUID;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Starting Field Agent Module Removal...';
    RAISE NOTICE '========================================';

    -- Get Field department ID
    SELECT id INTO field_dept_id FROM departments WHERE code = 'FIELD';
    
    IF field_dept_id IS NULL THEN
        RAISE NOTICE 'Field Agent department not found. Nothing to remove.';
        RETURN;
    END IF;

    -- Step 1: Delete audit logs for Field Agent employees
    RAISE NOTICE 'Step 1: Deleting audit logs for Field Agent employees...';
    DELETE FROM audit_logs
    WHERE employee_id IN (
        SELECT id FROM employees WHERE department_id = field_dept_id
    );
    GET DIAGNOSTICS deleted_audit_logs = ROW_COUNT;
    RAISE NOTICE 'Deleted % audit log entries', deleted_audit_logs;

    -- Step 2: Delete refresh tokens for Field Agent employees
    RAISE NOTICE 'Step 2: Deleting refresh tokens for Field Agent employees...';
    DELETE FROM refresh_tokens
    WHERE employee_id IN (
        SELECT id FROM employees WHERE department_id = field_dept_id
    );
    GET DIAGNOSTICS deleted_refresh_tokens = ROW_COUNT;
    RAISE NOTICE 'Deleted % refresh tokens', deleted_refresh_tokens;

    -- Step 3: Delete OTP logs for Field Agent employees
    RAISE NOTICE 'Step 3: Deleting OTP logs for Field Agent employees...';
    DELETE FROM otp_logs
    WHERE email IN (
        SELECT email FROM employees WHERE department_id = field_dept_id
    );
    GET DIAGNOSTICS deleted_otp_logs = ROW_COUNT;
    RAISE NOTICE 'Deleted % OTP log entries', deleted_otp_logs;

    -- Step 4: Delete Field Agent employees
    RAISE NOTICE 'Step 4: Deleting Field Agent employees...';
    DELETE FROM employees
    WHERE department_id = field_dept_id;
    GET DIAGNOSTICS deleted_employees = ROW_COUNT;
    RAISE NOTICE 'Deleted % Field Agent employees', deleted_employees;

    -- Step 5: Delete Field Agent roles
    RAISE NOTICE 'Step 5: Deleting Field Agent roles...';
    DELETE FROM roles
    WHERE department_id = field_dept_id;
    GET DIAGNOSTICS deleted_roles = ROW_COUNT;
    RAISE NOTICE 'Deleted % Field Agent roles', deleted_roles;

    -- Step 6: Delete Field Operations department
    RAISE NOTICE 'Step 6: Deleting Field Operations department...';
    DELETE FROM departments
    WHERE id = field_dept_id;
    GET DIAGNOSTICS deleted_department = ROW_COUNT;
    RAISE NOTICE 'Deleted % department (Field Operations)', deleted_department;

    -- Step 7: Drop field_agent_tasks table if it exists
    RAISE NOTICE 'Step 7: Dropping field_agent_tasks table...';
    DROP TABLE IF EXISTS field_agent_tasks CASCADE;
    RAISE NOTICE 'Dropped field_agent_tasks table';

    -- Step 8: Remove Field Agent columns from registrations table
    RAISE NOTICE 'Step 8: Removing Field Agent columns from registrations table...';
    
    -- Check and drop columns if they exist
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'registrations' AND column_name = 'field_agent_status'
    ) THEN
        ALTER TABLE registrations DROP COLUMN field_agent_status;
        RAISE NOTICE 'Dropped column: field_agent_status';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'registrations' AND column_name = 'field_agent_notes'
    ) THEN
        ALTER TABLE registrations DROP COLUMN field_agent_notes;
        RAISE NOTICE 'Dropped column: field_agent_notes';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'registrations' AND column_name = 'assigned_field_agent_id'
    ) THEN
        ALTER TABLE registrations DROP COLUMN assigned_field_agent_id;
        RAISE NOTICE 'Dropped column: assigned_field_agent_id';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'registrations' AND column_name = 'field_agent_assigned_at'
    ) THEN
        ALTER TABLE registrations DROP COLUMN field_agent_assigned_at;
        RAISE NOTICE 'Dropped column: field_agent_assigned_at';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Removal Summary:';
    RAISE NOTICE '  - Audit Logs: %', deleted_audit_logs;
    RAISE NOTICE '  - Refresh Tokens: %', deleted_refresh_tokens;
    RAISE NOTICE '  - OTP Logs: %', deleted_otp_logs;
    RAISE NOTICE '  - Employees: %', deleted_employees;
    RAISE NOTICE '  - Roles: %', deleted_roles;
    RAISE NOTICE '  - Departments: %', deleted_department;
    RAISE NOTICE '  - Tables Dropped: field_agent_tasks';
    RAISE NOTICE '  - Columns Removed: 4 from registrations';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Field Agent module removed successfully!';
    RAISE NOTICE '========================================';

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'ERROR: %', SQLERRM;
        RAISE NOTICE 'Removal failed. Transaction will be rolled back.';
        RAISE EXCEPTION 'Field Agent removal failed: %', SQLERRM;
END $$;

-- Verification Queries (Run these after cleanup to verify)
-- Uncomment to check results:

-- SELECT COUNT(*) as remaining_field_employees FROM employees e
-- JOIN departments d ON e.department_id = d.id WHERE d.code = 'FIELD';

-- SELECT COUNT(*) as remaining_field_dept FROM departments WHERE code = 'FIELD';

-- SELECT COUNT(*) as remaining_field_roles FROM roles r
-- JOIN departments d ON r.department_id = d.id WHERE d.code = 'FIELD';

-- SELECT table_name FROM information_schema.tables WHERE table_name = 'field_agent_tasks';
