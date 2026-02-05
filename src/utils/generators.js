/**
 * Generates a unique employee ID in the format EMP-XXXXXX
 * @returns {string} Unique employee ID
 */
exports.generateEmployeeId = () => {
    const min = 100000;
    const max = 999999;
    const num = Math.floor(Math.random() * (max - min + 1)) + min;
    return `EMP-${num}`;
};

/**
 * Generates a student ID in the format STU-YYYY-XXXX
 * @param {number} count - Current count of registrations to ensure uniqueness
 * @returns {string} Formatted student ID
 */
exports.generateStudentId = (count = 0) => {
    const year = new Date().getFullYear();
    const sequence = (1000 + count).toString();
    return `STU-${year}-${sequence}`;
};
