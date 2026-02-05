const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * 1. GET ALL NOTIFICATIONS FOR USER
 */
exports.getMyNotifications = async (req, res) => {
    try {
        const employee_id = req.user.id;
        const { limit = 20, unreadOnly = false } = req.query;

        let query = supabase
            .from('notifications')
            .select(`
                *,
                sender:employees!sender_id(id, name)
            `)
            .eq('recipient_id', employee_id)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (unreadOnly === 'true') {
            query = query.eq('is_read', false);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json(data);
    } catch (err) {
        logger.error(`Get Notifications Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to fetch notifications' });
    }
};

/**
 * 2. MARK AS READ
 */
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const employee_id = req.user.id;

        const { data, error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .match({ id, recipient_id: employee_id })
            .select()
            .single();

        if (error) throw error;

        res.json(data);
    } catch (err) {
        logger.error(`Mark Read Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to update notification' });
    }
};

/**
 * 3. MARK ALL AS READ
 */
exports.markAllAsRead = async (req, res) => {
    try {
        const employee_id = req.user.id;

        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('recipient_id', employee_id)
            .eq('is_read', false);

        if (error) throw error;

        res.json({ msg: 'All notifications cleared' });
    } catch (err) {
        logger.error(`Mark All Read Error: ${err.message}`);
        res.status(500).json({ msg: 'Action failed' });
    }
};
