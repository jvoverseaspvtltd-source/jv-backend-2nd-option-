-- Add processing fee and payment tracking to loan_applications
ALTER TABLE loan_applications 
ADD COLUMN IF NOT EXISTS processing_fee DECIMAL(12, 2) DEFAULT 57000.00,
ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS application_form_url TEXT;

-- Create loan_payments table if not exists for granular tracking
CREATE TABLE IF NOT EXISTS loan_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    loan_application_id UUID REFERENCES loan_applications(id) ON DELETE CASCADE,
    registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    payment_method TEXT,
    reference_number TEXT,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    recorded_by UUID -- Employee ID who recorded the payment
);

-- Trigger or Function to update paid_amount in loan_applications when a payment is added
CREATE OR REPLACE FUNCTION update_loan_paid_amount()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE loan_applications
    SET paid_amount = (
        SELECT COALESCE(SUM(amount), 0)
        FROM loan_payments
        WHERE loan_application_id = NEW.loan_application_id
    ),
    updated_at = NOW()
    WHERE id = NEW.loan_application_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_loan_paid_amount ON loan_payments;
CREATE TRIGGER trg_update_loan_paid_amount
AFTER INSERT OR UPDATE OR DELETE ON loan_payments
FOR EACH ROW EXECUTE FUNCTION update_loan_paid_amount();
