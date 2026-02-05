-- ============================================================================
-- ENTERPRISE CRM - ATTENDANCE & NOTES MIGRATION
-- Run this in Supabase SQL Editor to add attendance tracking and notes
-- ============================================================================

-- 1. CREATE ATTENDANCE LOGS TABLE
CREATE TABLE IF NOT EXISTS attendance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  login_time TIMESTAMPTZ,
  logout_time TIMESTAMPTZ,
  working_hours DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_logs(employee_id, date DESC);

-- 2. CREATE EMPLOYEE NOTES TABLE
CREATE TABLE IF NOT EXISTS employee_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_notes_employee ON employee_notes(employee_id, created_at DESC);

-- 3. ADD NEW COLUMNS TO EMPLOYEES TABLE (if not exists)
DO $$ 
BEGIN
    -- Add employment_type column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'employees' AND column_name = 'employment_type'
    ) THEN
        ALTER TABLE employees ADD COLUMN employment_type VARCHAR(50) DEFAULT 'Full-time';
    END IF;

    -- Add work_schedule column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'employees' AND column_name = 'work_schedule'
    ) THEN
        ALTER TABLE employees ADD COLUMN work_schedule VARCHAR(50) DEFAULT 'Mon - Fri';
    END IF;

    -- Add department_head column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'employees' AND column_name = 'department_head'
    ) THEN
        ALTER TABLE employees ADD COLUMN department_head VARCHAR(255);
    END IF;
END $$;

-- 4. UPDATE TRIGGER FOR attendance_logs updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_attendance_logs_updated_at
    BEFORE UPDATE ON attendance_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_notes_updated_at
    BEFORE UPDATE ON employee_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. GRANT PERMISSIONS (if using RLS)
-- ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE employee_notes ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (customize based on your needs):
-- CREATE POLICY "Employees can view their own attendance"
--   ON attendance_logs FOR SELECT
--   USING (employee_id = auth.uid());

-- CREATE POLICY "Admins can manage all attendance"
--   ON attendance_logs FOR ALL
--   USING (EXISTS (
--     SELECT 1 FROM employees 
--     WHERE id = auth.uid() AND departments.code = 'super_admin'
--   ));

COMMENT ON TABLE attendance_logs IS 'Employee daily attendance tracking with clock-in/out times';
COMMENT ON TABLE employee_notes IS 'Rich text notes for employee profiles with author tracking';
