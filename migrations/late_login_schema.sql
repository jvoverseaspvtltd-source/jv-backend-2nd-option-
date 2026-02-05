-- 1. Add shift_start_time to employees
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS shift_start_time TIME DEFAULT '10:00:00';

-- 2. Create late_login_requests table
CREATE TABLE IF NOT EXISTS late_login_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id),
    request_date DATE DEFAULT CURRENT_DATE,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    shift_time TIME NOT NULL,
    actual_login_time TIMESTAMPTZ NOT NULL,
    late_minutes INTEGER NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    action_by UUID REFERENCES employees(id),
    action_at TIMESTAMPTZ,
    admin_remarks TEXT
);

-- 3. Audit table for late requests (Optional, but good for tracking)
-- We can reuse the main audit_logs table for this.

-- 4. Policies (If RLS enabled)
-- ALTER TABLE late_login_requests ENABLE ROW LEVEL SECURITY;
