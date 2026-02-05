-- 1. ENHANCE registrations FOR INTAKE AND CANCELLATION
ALTER TABLE registrations 
ADD COLUMN IF NOT EXISTS intake TEXT,
ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMP WITH TIME ZONE;

-- 2. CREATE INTAKE DEFERRALS TRACKING TABLE
CREATE TABLE IF NOT EXISTS intake_deferrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    old_intake TEXT,
    new_intake TEXT,
    reason TEXT,
    updated_by UUID REFERENCES employees(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE intake_deferrals ENABLE ROW LEVEL SECURITY;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_intake_deferrals_reg ON intake_deferrals(registration_id);
