-- ============================================================================
-- ENHANCE ADMISSION APPLICATIONS MIGRATION
-- Adds fields for detailed university application tracking and offer management
-- to the admission_applications table.
-- ============================================================================

-- Ensure the table exists (it should, based on controller usage)
CREATE TABLE IF NOT EXISTS admission_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id UUID REFERENCES registrations(id),
  university VARCHAR(255) NOT NULL,
  course VARCHAR(255),
  intake VARCHAR(100),
  fees JSONB DEFAULT '{}', -- Existing structure based on controller
  status VARCHAR(50) DEFAULT 'Applied',
  assigned_to UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add new columns
ALTER TABLE admission_applications
ADD COLUMN IF NOT EXISTS program_name VARCHAR(255), -- Might duplicate course, but per requirements
ADD COLUMN IF NOT EXISTS course_duration VARCHAR(100),
ADD COLUMN IF NOT EXISTS tuition_fee NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS fees_structure TEXT, -- Detailed text or JSON
ADD COLUMN IF NOT EXISTS mode_of_attendance VARCHAR(50), 
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS campus_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS campus_address TEXT,
ADD COLUMN IF NOT EXISTS offer_letter_url TEXT,
ADD COLUMN IF NOT EXISTS additional_doc_url TEXT,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS admission_notes TEXT;

-- Comments
COMMENT ON COLUMN admission_applications.offer_letter_url IS 'URL to the uploaded Offer Letter PDF';
COMMENT ON COLUMN admission_applications.rejection_reason IS 'Mandatory reason if status is REJECTED or WITHDRAWN';
