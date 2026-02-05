-- QUICK FIX: Temporarily disable RLS for development
-- This allows all operations on student_documents table

ALTER TABLE student_documents DISABLE ROW LEVEL SECURITY;

-- Note: For production, you should enable RLS and create proper policies
-- To re-enable later: ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;
