const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('./audit.service');

/**
 * Normalizes an email address by trimming and converting to lowercase.
 * @param {string} email 
 * @returns {string} Normalized email
 */
const normalizeEmail = (email) => {
    if (!email) return '';
    return email.trim().toLowerCase();
};

/**
 * Checks if an email is already registered in the system (either as a student or employee).
 * @param {string} email - The email to check
 * @param {object} req - Express request object for audit logging (optional)
 * @returns {Promise<boolean>} True if email exists, false otherwise
 */
const isEmailRegistered = async (email, req = null) => {
    const normalizedEmail = normalizeEmail(email);

    try {
        // 1. Check in employees table
        const { data: employee, error: employeeError } = await supabase
            .from('employees')
            .select('id')
            .ilike('email', normalizedEmail)
            .maybeSingle();

        if (employee) {
            await logDuplicateBlocked(normalizedEmail, 'EMPLOYEE', req);
            return true;
        }

        // 2. Check in registrations (students) table
        const { data: registration, error: registrationError } = await supabase
            .from('registrations')
            .select('id')
            .ilike('email', normalizedEmail)
            .maybeSingle();

        if (registration) {
            await logDuplicateBlocked(normalizedEmail, 'STUDENT', req);
            return true;
        }

        return false;
    } catch (error) {
        logger.error(`Error checking email uniqueness: ${error.message}`);
        // If there's a DB error, we might want to fail safe or throw
        return false;
    }
};

/**
 * Helper to log duplicate email blocks
 */
const logDuplicateBlocked = async (email, type, req) => {
    await auditService.logAction({
        action: 'EMAIL_DUPLICATE_BLOCKED',
        metadata: {
            email,
            existingType: type,
            reason: `Attempted to register ${type} with an existing email`
        },
        ip: req?.ip || 'unknown',
        userAgent: req?.headers['user-agent'] || 'unknown'
    });
};

/**
 * Validates a phone number (Strict: Exactly 10 digits, only numbers).
 * @param {string} phone 
 * @returns {boolean} True if valid
 */
const validatePhone = (phone) => {
    if (!phone) return false;
    // Strictly exactly 10 digits, only numbers
    const phoneRegex = /^[0-9]{10}$/;
    return phoneRegex.test(phone.toString().trim());
};

/**
 * Validates an email address.
 * @param {string} email 
 * @returns {boolean} True if valid
 */
const validateEmail = (email) => {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.toString().trim().toLowerCase());
};

/**
 * Validates a Pincode (Strict: Exactly 6 digits, only numbers).
 * @param {string|number} pincode 
 * @returns {boolean} True if valid
 */
const validatePincode = (pincode) => {
    if (!pincode) return false;
    const pinRegex = /^[0-9]{6}$/;
    return pinRegex.test(pincode.toString().trim());
};

/**
 * Validates if an email belongs to the company domain.
 * 
 * ⚠️ TEMPORARY PRODUCTION EXCEPTION (Monday Launch):
 * Company email domain system will be implemented after launch.
 * 
 * CURRENT BEHAVIOR:
 * - Allows all valid email domains temporarily
 * - Email verification (OTP) is still mandatory
 * - Rate limits prevent abuse
 * - Admin approval required for staff accounts
 * 
 * POST-LAUNCH ACTION REQUIRED:
 * - Implement company domain whitelist (@jvoversea.com)
 * - Migrate existing users to company emails
 * - Enforce domain restriction
 * 
 * @param {string} email 
 * @returns {boolean} Always true (temporary - see comment above)
 */
const validateCompanyEmail = (email) => {
    // TEMPORARY: Allow all email domains until company email system is ready
    // TODO: After launch, implement domain whitelist enforcement
    // This is a launch-safe temporary measure, not a permanent solution
    return true;
};

module.exports = {
    normalizeEmail,
    isEmailRegistered,
    validatePhone,
    validateEmail,
    validatePincode,
    validateCompanyEmail
};
