-- ============================================================================
-- FIX EXISTING ADMIN ROLE ASSIGNMENTS
-- This script fixes employees where is_admin = true but role doesn't match
-- ============================================================================

DO $$
DECLARE
    emp_record RECORD;
    correct_role_id UUID;
    dept_code TEXT;
BEGIN
    -- Loop through all employees marked as admin
    FOR emp_record IN 
        SELECT e.id, e.name, e.email, e.is_admin, e.role_id, e.department_id,
               d.code as dept_code, r.name as current_role_name
        FROM employees e
        JOIN departments d ON e.department_id = d.id
        LEFT JOIN roles r ON e.role_id = r.id
        WHERE e.is_admin = true
    LOOP
        -- Determine the correct admin role based on department
        CASE emp_record.dept_code
            WHEN 'COUN' THEN
                SELECT id INTO correct_role_id FROM roles 
                WHERE name = 'Counselling Admin' AND department_id = emp_record.department_id;
            WHEN 'ADMN' THEN
                SELECT id INTO correct_role_id FROM roles 
                WHERE name = 'Admission Admin' AND department_id = emp_record.department_id;
            WHEN 'WFH' THEN
                SELECT id INTO correct_role_id FROM roles 
                WHERE name = 'WFH Admin' AND department_id = emp_record.department_id;
            WHEN 'ADMIN' THEN
                SELECT id INTO correct_role_id FROM roles 
                WHERE name = 'Super Administrator' AND department_id = emp_record.department_id;
            ELSE
                RAISE NOTICE 'Unknown department code: % for employee %', emp_record.dept_code, emp_record.email;
                CONTINUE;
        END CASE;

        -- If the current role doesn't match the correct admin role, update it
        IF emp_record.role_id != correct_role_id OR emp_record.role_id IS NULL THEN
            RAISE NOTICE 'Fixing employee %: % → % (dept: %)', 
                emp_record.email, 
                emp_record.current_role_name, 
                CASE emp_record.dept_code
                    WHEN 'COUN' THEN 'Counselling Admin'
                    WHEN 'ADMN' THEN 'Admission Admin'
                    WHEN 'WFH' THEN 'WFH Admin'
                    WHEN 'ADMIN' THEN 'Super Administrator'
                END,
                emp_record.dept_code;

            UPDATE employees 
            SET role_id = correct_role_id,
                updated_at = NOW()
            WHERE id = emp_record.id;
        ELSE
            RAISE NOTICE 'Employee % already has correct admin role', emp_record.email;
        END IF;
    END LOOP;

    RAISE NOTICE 'Admin role fix completed!';
END $$;

-- ============================================================================
-- VERIFICATION QUERY
-- Run this after the migration to verify all admins have correct roles
-- ============================================================================
SELECT 
    e.name,
    e.email,
    e.is_admin,
    d.code as department,
    r.name as role_name,
    CASE 
        WHEN e.is_admin = true AND r.name LIKE '%Admin%' THEN '✓ CORRECT'
        WHEN e.is_admin = false AND r.name NOT LIKE '%Admin%' THEN '✓ CORRECT'
        ELSE '✗ MISMATCH'
    END as status
FROM employees e
JOIN departments d ON e.department_id = d.id
LEFT JOIN roles r ON e.role_id = r.id
ORDER BY e.is_admin DESC, d.code, e.name;
