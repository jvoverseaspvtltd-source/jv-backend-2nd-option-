const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * Log an action to the audit_logs table
 * @param {string} employeeId - ID of the employee performing the action (optional for anon actions like login attempt)
 * @param {string} action - Descriptive name of the action (e.g., 'LOGIN_SUCCESS')
 * @param {object} metadata - Additional JSON data (IP, browser info, payload snippets)
 * @param {string} ip - IP address of the requester
 * @param {string} userAgent - User agent string
 */
const logAction = async ({ employeeId = null, action, metadata = {}, ip = 'unknown', userAgent = 'unknown' }) => {
    try {
        const { error } = await supabase
            .from('audit_logs')
            .insert({
                employee_id: employeeId,
                action,
                metadata,
                ip_address: ip,
                user_agent: userAgent
            });

        if (error) {
            logger.error(`Failed to save audit log: ${error.message}`);
        }
    } catch (err) {
        logger.error(`Audit service error: ${err.message}`);
    }
};

module.exports = { logAction };
