/**
 * Masks sensitive information in a string or object
 */

const maskPhone = (phone) => {
    if (!phone || phone.length < 4) return '********';
    return '*'.repeat(phone.length - 4) + phone.slice(-4);
};

const maskEmail = (email) => {
    if (!email || !email.includes('@')) return '******@***.com';
    const [local, domain] = email.split('@');
    const maskedLocal = local.length > 2
        ? local.substring(0, 2) + '*'.repeat(local.length - 2)
        : local + '*';
    return `${maskedLocal}@${domain}`;
};

/**
 * Recursively masks sensitive fields in an object or array of objects
 * @param {Object|Array} data - The data to mask
 * @param {Array<string>} roles - User roles
 * @returns {Object|Array} Masked data
 */
const maskData = (data, userRole) => {
    // Roles authorized to see full data
    const FULL_ACCESS_ROLES = [
        'super_admin', 'counselling_admin', 'admission_admin', 'admin',
        'counsellor', 'admission', 'wfh', 'field'
    ];

    // If user has full access, return original data
    if (FULL_ACCESS_ROLES.includes(userRole)) {
        return data;
    }

    // Helper to mask single object
    const maskObject = (obj) => {
        if (!obj) return obj;
        const masked = { ...obj }; // Shallow copy

        if (masked.phone) masked.phone = maskPhone(masked.phone);
        if (masked.email) masked.email = maskEmail(masked.email);
        if (masked.father_phone) masked.father_phone = maskPhone(masked.father_phone);

        // Hide specific fields completely if needed
        // delete masked.address; 

        return masked;
    };

    if (Array.isArray(data)) {
        return data.map(item => maskObject(item));
    }

    return maskObject(data);
};

module.exports = {
    maskPhone,
    maskEmail,
    maskData
};
