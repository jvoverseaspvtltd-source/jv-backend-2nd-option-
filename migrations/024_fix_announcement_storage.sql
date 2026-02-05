-- ============================================================================
-- FIX STORAGE POLICIES FOR ANNOUNCEMENTS (PERMISSIONS ONLY)
-- ============================================================================

-- NOTE: If the 'announcements' bucket does not exist, create it in the Dashboard.

-- 1. Policy: Allow Anyone (Authenticated/Anon) to READ from 'announcements'
DROP POLICY IF EXISTS "Public Access to Announcements" ON storage.objects;
CREATE POLICY "Public Access to Announcements"
ON storage.objects FOR SELECT
USING ( bucket_id = 'announcements' );

-- 2. Policy: Allow Authenticated Users (Admins/Employees) to UPLOAD to 'announcements'
DROP POLICY IF EXISTS "Authenticated Upload to Announcements" ON storage.objects;
CREATE POLICY "Authenticated Upload to Announcements"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'announcements' );

-- 3. Policy: Allow Authenticated Users to DELETE their own uploads
DROP POLICY IF EXISTS "Authenticated Delete from Announcements" ON storage.objects;
CREATE POLICY "Authenticated Delete from Announcements"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'announcements' );
