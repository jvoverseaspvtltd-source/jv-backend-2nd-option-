-- ============================================================================
-- ENHANCE EMPLOYEE PROFILE (DOB, BIO, GENDER, ADDRESS, EMERGENCY CONTACT)
-- ============================================================================

DO $$
BEGIN
    -- Add Date of Birth (DOB)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'dob') THEN
        ALTER TABLE employees ADD COLUMN dob DATE;
    END IF;

    -- Add Bio / About Yourself
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'bio') THEN
        ALTER TABLE employees ADD COLUMN bio TEXT;
    END IF;

    -- Add Gender
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'gender') THEN
        ALTER TABLE employees ADD COLUMN gender VARCHAR(15);
    END IF;

    -- Add Address
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'address') THEN
        ALTER TABLE employees ADD COLUMN address TEXT;
    END IF;

    -- Add Emergency Contact Number
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'emergency_contact') THEN
        ALTER TABLE employees ADD COLUMN emergency_contact VARCHAR(20);
    END IF;

    -- Add Last Profile Updated Timestamp
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'last_profile_updated_at') THEN
        ALTER TABLE employees ADD COLUMN last_profile_updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

END $$;
