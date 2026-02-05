-- Fix RLS policies for student_documents table
-- This allows authenticated users to upload and view documents

-- Drop existing policies if any
DROP POLICY IF EXISTS "Students can upload documents" ON student_documents;
DROP POLICY IF EXISTS "Students can view documents" ON student_documents;
DROP POLICY IF EXISTS "Employees can view all documents" ON student_documents;
DROP POLICY IF EXISTS "Employees can update documents" ON student_documents;

-- Allow authenticated users to insert documents
CREATE POLICY "Students can upload documents" ON student_documents
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to view documents
CREATE POLICY "Students can view documents" ON student_documents
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to update their documents (for status changes)
CREATE POLICY "Users can update documents" ON student_documents
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow deletion (for admins/students)
CREATE POLICY "Users can delete documents" ON student_documents
FOR DELETE
TO authenticated
USING (true);
