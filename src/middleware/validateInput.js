const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Middleware to validate request input and sanitize data
 * Prevents injection attacks and malformed requests
 */
const validateInput = (req, res, next) => {
    // Check for validation errors from express-validator
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        logger.warn('Input validation failed:', {
            url: req.url,
            method: req.method,
            errors: errors.array()
        });
        
        return res.status(400).json({
            success: false,
            msg: 'Validation failed',
            errors: errors.array()
        });
    }

    // Basic sanitization: Remove any unexpected fields that might cause issues
    // This is a minimal safety measure - proper validation should be done per-route
    if (req.body && typeof req.body === 'object') {
        // Remove any fields with suspicious patterns (basic XSS prevention)
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                // Remove potential script tags (basic protection)
                if (req.body[key].includes('<script') || req.body[key].includes('javascript:')) {
                    logger.warn(`Potentially malicious input detected in field: ${key}`);
                    delete req.body[key];
                }
            }
        });
    }

    next();
};

module.exports = validateInput;

