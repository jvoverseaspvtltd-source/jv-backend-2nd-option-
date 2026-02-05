-- ============================================================================
-- FORCE ENABLE ANNOUNCEMENT UPLOADS (RLS OVERRIDE)
-- ============================================================================

-- 1. Ensure the policy is dropped cleanly to avoid conflicts
DROP POLICY IF EXISTS "Authenticated Upload to Announcements" ON storage.objects;
DROP POLICY IF EXISTS "Allow All Authenticated Uploads" ON storage.objects;

-- 2. Create a broader, more permissive policy for the 'announcements' bucket
-- This explicitly allows ANY authenticated user to insert ANY file into 'announcements'
CREATE POLICY "Allow All Authenticated Uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'announcements' );

-- 3. Ensure Update/Delete is also covered for management
DROP POLICY IF EXISTS "Allow Authenticated Updates" ON storage.objects;
CREATE POLICY "Allow Authenticated Updates"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'announcements' );

DROP POLICY IF EXISTS "Allow Authenticated Deletes" ON storage.objects;
CREATE POLICY "Allow Authenticated Deletes"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'announcements' );
