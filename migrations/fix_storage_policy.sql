-- FIX STORAGE PERMISSIONS (Updated to avoid ownership errors)
-- Run this in Supabase SQL Editor

-- 1. Create policies for the 'study-materials' bucket
-- We use DO blocks or DROP IF EXISTS to avoid errors if they already exist

DROP POLICY IF EXISTS "Allow Authenticated Uploads" ON storage.objects;
CREATE POLICY "Allow Authenticated Uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'study-materials');

DROP POLICY IF EXISTS "Allow Authenticated Downloads" ON storage.objects;
CREATE POLICY "Allow Authenticated Downloads" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'study-materials');

-- 2. Allow Authenticated users to update/delete their own files
DROP POLICY IF EXISTS "Allow Users to Update Own Files" ON storage.objects;
CREATE POLICY "Allow Users to Update Own Files" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'study-materials' AND owner = auth.uid());

DROP POLICY IF EXISTS "Allow Users to Delete Own Files" ON storage.objects;
CREATE POLICY "Allow Users to Delete Own Files" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'study-materials' AND owner = auth.uid());

-- NOTE: If you still get permission errors, ensure you are running this
-- in the "SQL Editor" of the Supabase Dashboard, which usually runs as postgres.
