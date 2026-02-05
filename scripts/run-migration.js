const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
    console.log('Running migration: Add tuition_fee_currency column...');

    try {
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: `
                ALTER TABLE admission_applications
                ADD COLUMN IF NOT EXISTS tuition_fee_currency VARCHAR(10) DEFAULT 'USD';
                
                COMMENT ON COLUMN admission_applications.tuition_fee_currency IS 'Currency code for tuition fee (USD, AED, INR, GBP, EUR, CAD, AUD, etc.)';
            `
        });

        if (error) {
            console.error('Migration failed:', error);
            console.log('\n⚠️  The RPC method might not exist. Please run this SQL manually in your database:');
            console.log('\nALTER TABLE admission_applications');
            console.log("ADD COLUMN IF NOT EXISTS tuition_fee_currency VARCHAR(10) DEFAULT 'USD';");
            process.exit(1);
        }

        console.log('✅ Migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        console.log('\n⚠️  Please run this SQL manually in your database:');
        console.log('\nALTER TABLE admission_applications');
        console.log("ADD COLUMN IF NOT EXISTS tuition_fee_currency VARCHAR(10) DEFAULT 'USD';");
        process.exit(1);
    }
}

runMigration();
