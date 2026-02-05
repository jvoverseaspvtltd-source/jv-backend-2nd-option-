const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * Global Notification Service
 * Handles persistence and triggering for all system alerts
 */
class NotificationService {

    /**
     * send: Internal method to create a notification record
     */
    async send({ recipient_id, sender_id, title, message, type = 'GENERAL', priority = 'NORMAL', link = null }) {
        try {
            if (!recipient_id) return;

            const { data, error } = await supabase
                .from('notifications')
                .insert([{
                    recipient_id,
                    sender_id,
                    title,
                    message,
                    type,
                    priority,
                    link
                }])
                .select()
                .single();

            if (error) throw error;

            // TODO: In a production environment with Socket.io, 
            // you would emit a real-time event here:
            // io.to(recipient_id).emit('notification', data);

            return data;
        } catch (err) {
            logger.error(`Notification Error: ${err.message}`);
            return null;
        }
    }

    /**
     * notifyDepartment: Broadcasts a notification to an entire department
     */
    async notifyDepartment({ department_id, sender_id, title, message, type, priority, link }) {
        try {
            // Get all active employees in department
            const { data: employees } = await supabase
                .from('employees')
                .select('id')
                .eq('department_id', department_id);

            if (!employees || employees.length === 0) return;

            const notifications = employees.map(emp => ({
                recipient_id: emp.id,
                sender_id,
                title,
                message,
                type,
                priority,
                link
            }));

            const { error } = await supabase.from('notifications').insert(notifications);
            if (error) throw error;
        } catch (err) {
            logger.error(`Dept Notification Error: ${err.message}`);
        }
    }
}

module.exports = new NotificationService();
