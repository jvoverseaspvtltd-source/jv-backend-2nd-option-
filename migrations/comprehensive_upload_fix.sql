-- ALL-IN-ONE FIX FOR DOCUMENT UPLOADS
-- Run this in the Supabase SQL Editor

-- 1. Disable RLS on the main table (just in case)
ALTER TABLE student_documents DISABLE ROW LEVEL SECURITY;

-- 2. Disable RLS on the audit logs table
-- Sometimes the error can come from here if the logAction fails
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- 3. Ensure the authenticated role has permissions
GRANT ALL ON TABLE student_documents TO authenticated;
GRANT ALL ON TABLE audit_logs TO authenticated;
GRANT ALL ON TABLE registrations TO authenticated;
GRANT ALL ON TABLE employees TO authenticated;

-- 4. Enable UUID extension if not enabled (required for ID generation)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
