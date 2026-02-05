-- ============================================================================
-- ADMISSION MODULE MIGRATION
-- ============================================================================

-- 1. ENHANCE REGISTRATIONS TABLE
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS admission_status VARCHAR(50) DEFAULT 'PENDING';

-- 2. TASKS TABLE
CREATE TABLE IF NOT EXISTS admission_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES employees(id),
  assigned_by UUID REFERENCES employees(id),
  status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED
  priority VARCHAR(20) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, URGENT
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ANNOUNCEMENTS TABLE
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'NORMAL', -- NORMAL, IMPORTANT, CRITICAL
  target_audience VARCHAR(50) DEFAULT 'ALL', -- ALL, DEPARTMENT, TEAM
  target_department_id UUID REFERENCES departments(id),
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. STUDY MATERIALS / NOTES TABLE
CREATE TABLE IF NOT EXISTS study_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT, -- Supports Rich Text
  category VARCHAR(100), -- Country, University, Process, etc.
  attachments JSONB DEFAULT '[]',
  created_by UUID REFERENCES employees(id),
  updated_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. OPERATIONAL QUERIES (Problems)
CREATE TABLE IF NOT EXISTS operational_queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH
  status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, IN_REVIEW, RESOLVED
  created_by UUID REFERENCES employees(id),
  assigned_to UUID REFERENCES employees(id), -- Admin who will resolve
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. OPERATIONAL SOLUTIONS
CREATE TABLE IF NOT EXISTS operational_solutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id UUID REFERENCES operational_queries(id) ON DELETE CASCADE,
  solution TEXT NOT NULL,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. AUDIT LOGS TRIGGER (Optional, but good practice for updated_at)
-- This assumes a trigger function update_updated_at_column exists or is created
-- For simplicity, we will handle updated_at in the controller for now.
