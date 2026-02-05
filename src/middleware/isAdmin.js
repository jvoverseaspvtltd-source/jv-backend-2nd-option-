const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

module.exports = async function (req, res, next) {
    try {
        // Find employee in Supabase
        const { data: employee, error } = await supabase
            .from('employees')
            .select('id, email, is_admin, roles(name)')
            .eq('id', req.user.id)
            .single();

        if (error || !employee) {
            return res.status(401).json({ msg: 'Employee not found' });
        }

        // Logic: Allow if is_admin flag is true OR if the role name contains "Admin"
        const roleName = employee.roles?.name || '';
        const isActuallyAdmin = employee.is_admin === true ||
            roleName.includes('Admin') ||
            roleName.includes('Administrator');

        if (!isActuallyAdmin) {
            logger.warn(`Access denied. Employee ${employee.email} (Role: ${roleName}) tried to access admin route.`);
            return res.status(403).json({ msg: 'Access denied. Administrator privileges required.' });
        }

        next();
    } catch (err) {
        logger.error(`Admin middleware error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};
