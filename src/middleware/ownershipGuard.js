const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * Middleware to ensure the authenticated user belongs to the department 
 * that currently owns the registration.
 */
module.exports = async function (req, res, next) {
    const registrationId = req.params.id || req.body.registrationId;

    if (!registrationId) {
        return res.status(400).json({ msg: 'Registration ID is required for ownership check' });
    }

    try {
        // Super Admins bypass ownership checks
        if (req.user.role === 'super_admin' || req.user.is_admin) {
            return next();
        }

        const { data: registration, error } = await supabase
            .from('registrations')
            .select('workflow')
            .eq('id', registrationId)
            .single();

        if (error || !registration) {
            return res.status(404).json({ msg: 'Registration not found' });
        }

        const currentOwner = registration.workflow?.currentOwner;
        const userDept = req.user.dept; // e.g., 'COUNSELLOR', 'ADMISSION'

        if (!currentOwner) {
            logger.warn(`Registration ${registrationId} has no owner defined. Allowing access.`);
            return next();
        }

        // Check if user department matches current owner
        // Note: We should normalize case or use a map if dept codes differ from owner labels
        if (userDept.toUpperCase() !== currentOwner.toUpperCase()) {
            return res.status(403).json({
                msg: 'Access Denied: Your department does not currently own this record',
                currentOwner,
                yourDept: userDept
            });
        }

        next();
    } catch (err) {
        logger.error(`ownershipGuard Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error during ownership verification' });
    }
};
