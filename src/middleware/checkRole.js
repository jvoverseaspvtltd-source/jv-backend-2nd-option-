const logger = require('../utils/logger');

/**
 * Middleware to check if the user has one of the required roles
 * @param {string[]} roles - Array of allowed roles
 */
const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ msg: 'No user found' });
        }

        const userRole = req.user.role?.toLowerCase();
        const allowedRoles = roles.map(r => r.toLowerCase());

        if (!allowedRoles.includes(userRole)) {
            logger.warn(`Access Denied: User role '${userRole}' not in allowed roles [${allowedRoles}]`);
            return res.status(403).json({ msg: 'Access denied: insufficient permissions' });
        }

        next();
    };
};

module.exports = checkRole;
