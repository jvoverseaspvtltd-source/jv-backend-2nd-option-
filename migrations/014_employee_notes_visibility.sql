-- Migration: Add visibility and status tags to employee_notes
-- Applied: [DATE]

-- 1. Add is_visible_to_employee column
ALTER TABLE employee_notes 
ADD COLUMN IF NOT EXISTS is_visible_to_employee BOOLEAN DEFAULT FALSE;

-- 2. Add status_tag column
ALTER TABLE employee_notes 
ADD COLUMN IF NOT EXISTS status_tag VARCHAR(50) DEFAULT 'Info';

-- 3. Add commentary for clarity
COMMENT ON COLUMN employee_notes.is_visible_to_employee IS 'Controls if the note is visible to the employee on their own profile';
COMMENT ON COLUMN employee_notes.status_tag IS 'Category of the note (Info, Warning, Appreciation)';
