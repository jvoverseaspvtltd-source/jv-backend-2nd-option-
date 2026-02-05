-- 1. FIX LEADS TABLE (Soft Deletion)
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_is_deleted ON leads(is_deleted);

-- 2. FIX REGISTRATIONS TABLE (Intake and Cancellation)
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS intake TEXT,
ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMP WITH TIME ZONE;

-- 3. CREATE INTAKE DEFERRALS TRACKING TABLE
CREATE TABLE IF NOT EXISTS intake_deferrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    old_intake TEXT,
    new_intake TEXT,
    reason TEXT,
    updated_by UUID REFERENCES employees(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for intake_deferrals
ALTER TABLE intake_deferrals ENABLE ROW LEVEL SECURITY;

-- Add index for performance on intake_deferrals
CREATE INDEX IF NOT EXISTS idx_intake_deferrals_reg ON intake_deferrals(registration_id);

-- 4. BASIC RLS POLICIES FOR INTAKE DEFERRALS (Allow authenticated access for now)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'intake_deferrals' AND policyname = 'Allow authenticated access'
    ) THEN
        CREATE POLICY "Allow authenticated access" ON intake_deferrals
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;
