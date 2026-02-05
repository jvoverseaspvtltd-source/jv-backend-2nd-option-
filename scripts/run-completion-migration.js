const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '../migrations/20260202_add_completion_flags.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration: add_completion_flags...');

        // Execute the SQL
        const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            // If exec_sql RPC doesn't exist, we might need another approach or manual execution
            console.error('Migration failed:', error.message);
            console.log('--- MANUAL SQL FOR SUPABASE DASHBOARD ---');
            console.log(sql);
            console.log('------------------------------------------');
        } else {
            console.log('Migration successful!');
        }
    } catch (err) {
        console.error('Error running migration:', err.message);
    }
}

runMigration();
