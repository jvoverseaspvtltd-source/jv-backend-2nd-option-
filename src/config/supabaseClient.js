const { createClient } = require('@supabase/supabase-js');
const config = require('./env');

const supabaseUrl = config.supabaseUrl;
const supabaseKey = config.supabaseKey;

if (!supabaseUrl || !supabaseKey) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Missing Supabase URL or Key');
    } else {
        const logger = require('../utils/logger');
        logger.warn('⚠️  Warning: Missing Supabase URL or Key in environment variables.');
    }
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
