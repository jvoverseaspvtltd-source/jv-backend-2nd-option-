-- Add file_path column to study_materials to track physical storage objects
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS file_path TEXT;
