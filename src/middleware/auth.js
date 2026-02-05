const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../utils/logger');

module.exports = function (req, res, next) {
    // Get token from header - support both formats
    let token = req.header('x-auth-token');

    // If not found, check Authorization header with Bearer format
    if (!token) {
        const authHeader = req.header('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7); // Remove 'Bearer ' prefix
        }
    }

    // Check if no token
    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    // Verify token with department-specific secret
    try {
        // First, decode without verification to get the department/role
        const decoded = jwt.decode(token);

        if (!decoded || !decoded.user) {
            return res.status(401).json({ msg: 'Invalid token format' });
        }

        // Target identifying which secret to use
        const deptCode = (decoded.user.dept || '').toUpperCase();
        const role = (decoded.user.role || '').toUpperCase();

        // Try to match secret by Department Code first, then by Role (for older tokens), then fallback to general secret
        const secretKey = config.jwtSecrets[deptCode] ? 'DEPT_SECRET' : (config.jwtSecrets[role] ? 'ROLE_SECRET' : 'GENERAL_SECRET');
        const jwtSecret = config.jwtSecrets[deptCode] || config.jwtSecrets[role] || config.jwtSecret;

        logger.info(`[AUTH_DEBUG] Resolving secret for ${decoded.user.email}. Dept: ${deptCode}, Role: ${role}. Using: ${secretKey}`);

        // Now verify with the resolved secret
        const verified = jwt.verify(token, jwtSecret);
        req.user = verified.user;

        logger.info(`[AUTH] Token verified for user: ${req.user.email} (Dept: ${deptCode || 'None'}, Role: ${role || 'None'})`);
        next();
    } catch (err) {
        logger.error(`Token verification failed for token: ${token.substring(0, 10)}... Error: ${err.message}`);
        res.status(401).json({ msg: 'Token is not valid', details: err.message });
    }
};
