-- ============================================================================
-- FINAL FIX: ALLOW BACKEND (ANON/PUBLIC) UPLOADS
-- ============================================================================

-- The backend might be connecting as 'anon' if the Service Key is missing.
-- We must allow the 'public' role to insert into this specific bucket.

-- 1. Drop restrictve policies
DROP POLICY IF EXISTS "Allow All Authenticated Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload to Announcements" ON storage.objects;

-- 2. Allow PUBLIC (Anonymous) uploads to 'announcements' bucket
-- Security Note: The Backend API protects the upload endpoint via JWT checks.
-- Direct access to Supabase Storage by outsiders is possible but limited to this bucket.
CREATE POLICY "Allow Public Uploads to Announcements"
ON storage.objects FOR INSERT
TO public
WITH CHECK ( bucket_id = 'announcements' );

-- 3. Allow Public Updates/Deletes (for admin management consistency)
DROP POLICY IF EXISTS "Allow Authenticated Updates" ON storage.objects;
CREATE POLICY "Allow Public Updates"
ON storage.objects FOR UPDATE
TO public
USING ( bucket_id = 'announcements' );

DROP POLICY IF EXISTS "Allow Authenticated Deletes" ON storage.objects;
CREATE POLICY "Allow Public Deletes"
ON storage.objects FOR DELETE
TO public
USING ( bucket_id = 'announcements' );
