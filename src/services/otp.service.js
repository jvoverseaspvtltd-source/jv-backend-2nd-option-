const crypto = require('crypto');

/**
 * Generate cryptographically secure random OTP
 * @param {number} length - OTP length (default: 6)
 * @returns {string} - Random OTP string
 */
const generateOTP = (length = 6) => {
    // Use crypto.randomInt for cryptographically secure random numbers
    const digits = '0123456789';
    let otp = '';
    
    // Ensure minimum length of 4 and maximum of 8 for security
    const safeLength = Math.max(4, Math.min(8, length));
    
    for (let i = 0; i < safeLength; i++) {
        // Use crypto.randomInt for secure randomness
        otp += digits[crypto.randomInt(0, 10)];
    }
    
    return otp;
};

/**
 * Validate OTP format (numeric, correct length)
 * @param {string|number} otp - OTP to validate
 * @param {number} expectedLength - Expected length (default: 6)
 * @returns {boolean} - True if valid format
 */
const validateOTPFormat = (otp, expectedLength = 6) => {
    if (!otp) return false;
    const otpStr = otp.toString().trim();
    return /^\d+$/.test(otpStr) && otpStr.length === expectedLength;
};

/**
 * Check if OTP is expired
 * @param {Date|string} expiresAt - Expiry timestamp
 * @returns {boolean} - True if expired
 */
const isOTPExpired = (expiresAt) => {
    if (!expiresAt) return true;
    return new Date(expiresAt) < new Date();
};

module.exports = {
    generateOTP,
    validateOTPFormat,
    isOTPExpired
};
