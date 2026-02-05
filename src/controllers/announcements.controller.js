const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const notificationService = require('../services/notification.service');
const { uploadToSupabase } = require('../middleware/storage.middleware');

/**
 * 1. CREATE ANNOUNCEMENT (Admin Only)
 */
exports.createAnnouncement = async (req, res) => {
    try {
        const {
            title, summary, content, type, priority,
            target_all, target_departments, target_roles,
            scheduled_at, expires_at, is_pinned
        } = req.body;

        const employee_id = req.user.id;
        const employee_role = req.user.role?.toUpperCase();

        // 🛡️ Security Check: Dept Admin can only target their own department
        if (employee_role !== 'SUPER_ADMIN' && !target_all) {
            const isTargetingOthers = target_departments?.some(id => id !== req.user.dept);
            if (isTargetingOthers) {
                return res.status(403).json({ msg: 'Dept Admins can only target their own department' });
            }
        }

        const { data, error } = await supabase
            .from('announcements')
            .insert([{
                title,
                summary,
                content,
                type: type || 'GENERAL',
                priority: priority || 'NORMAL',
                target_all,
                target_departments: target_departments || [],
                target_roles: target_roles || [],
                scheduled_at: scheduled_at || new Date(),
                expires_at,
                is_pinned: is_pinned || false,
                is_published: scheduled_at ? false : true, // Auto-publish if no schedule
                created_by: employee_id
            }])
            .select()
            .single();

        if (error) throw error;

        // 📝 Detailed Audit Log
        await supabase.from('announcement_audit_logs').insert([{
            announcement_id: data.id,
            action: 'CREATED',
            performed_by: employee_id,
            new_value: { title, type, target_all }
        }]);

        await auditService.logAction({
            action: 'ANNOUNCEMENT_CREATE',
            user_id: employee_id,
            metadata: { announcement_id: data.id, title },
            ip: req.ip
        });

        // 📢 Direct Notification if published immediately
        if (data.is_published) {
            await triggerAnnouncementNotifications(data, employee_id);
        }

        res.status(201).json(data);
    } catch (err) {
        logger.error(`Create Announcement Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

/**
 * 2. GET ANNOUNCEMENTS (Visibility Gated + Aggregated Reactions)
 */
exports.getAnnouncements = async (req, res) => {
    try {
        const { id: employee_id, role, dept: employee_dept } = req.user;
        const uRole = role?.toUpperCase();

        // Query based on targeting rules
        let query = supabase
            .from('announcements')
            .select(`
                *,
                created_by:employees!created_by(id, name),
                engagement:announcement_engagements(is_read, acknowledged),
                reactions:announcement_reactions(emoji, employee_id)
            `)
            .eq('is_deleted', false)
            .eq('is_published', true);

        // Filters for scheduled/expired items
        query = query.lte('scheduled_at', new Date().toISOString());
        query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

        // 🛡️ RBAC & Targeting Logic
        if (uRole !== 'SUPER_ADMIN') {
            // Find department UUID for the code in token
            const { data: dept } = await supabase
                .from('departments')
                .select('id')
                .eq('code', employee_dept)
                .single();

            let filterStr = `target_all.eq.true,target_roles.cs.{${uRole}}`;
            if (dept) {
                filterStr += `,target_departments.cs.{${dept.id}}`;
            }
            query = query.or(filterStr);
        } else if (req.query.department_id) {
            // Super Admin filtering by department
            // Show announcements that target this specific department OR target all
            query = query.or(`target_all.eq.true,target_departments.cs.{${req.query.department_id}}`);
        }

        const { data, error } = await query
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(data);
    } catch (err) {
        logger.error(`Get Announcements Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', details: err.message });
    }
};

/**
 * 3. TRACK READ / ACKNOWLEDGE
 */
exports.trackEngagement = async (req, res) => {
    try {
        const { id: announcement_id } = req.params;
        const { acknowledge = false } = req.body;
        const employee_id = req.user.id;

        const { data, error } = await supabase
            .from('announcement_engagements')
            .upsert({
                announcement_id,
                employee_id,
                is_read: true,
                read_at: new Date(),
                acknowledged: acknowledge,
                acknowledged_at: acknowledge ? new Date() : null
            }, { onConflict: 'announcement_id,employee_id' })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        logger.error(`Track Engagement Error: ${err.message}`);
        res.status(500).json({ msg: 'Action failed' });
    }
};

/**
 * 4. TOGGLE REACTION
 */
exports.toggleReaction = async (req, res) => {
    try {
        const { id: announcement_id } = req.params;
        const { emoji } = req.body;
        const employee_id = req.user.id;

        // Check if reaction exists
        const { data: existing } = await supabase
            .from('announcement_reactions')
            .select('id')
            .eq('announcement_id', announcement_id)
            .eq('employee_id', employee_id)
            .eq('emoji', emoji)
            .single();

        if (existing) {
            // Remove
            const { error } = await supabase
                .from('announcement_reactions')
                .delete()
                .eq('id', existing.id);
            if (error) throw error;
            return res.json({ msg: 'Reaction removed', active: false });
        } else {
            // Add
            const { error } = await supabase
                .from('announcement_reactions')
                .insert([{ announcement_id, employee_id, emoji }]);
            if (error) throw error;
            return res.json({ msg: 'Reaction added', active: true });
        }
    } catch (err) {
        logger.error(`Toggle Reaction Error: ${err.message}`);
        res.status(500).json({ msg: 'Reaction failed' });
    }
};

/**
 * 5. UPLOAD MEDIA (ADMIN ONLY)
 */
exports.uploadMedia = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ msg: 'No file provided' });

        const result = await uploadToSupabase(req.file, 'announcements');

        // Construct public/signed URL logic 
        // For simplicity and Tiptap embedding, we'll return a direct reference if bucket is public, 
        // or a signed URL if private.
        const { data: { publicUrl } } = supabase.storage
            .from('announcements')
            .getPublicUrl(result.path);

        res.json({ url: publicUrl, path: result.path });
    } catch (err) {
        logger.error(`Announcement Media Upload Error: ${err.message}`);
        res.status(500).json({ msg: 'Media upload failed' });
    }
};

/**
 * 6. DELETE ANNOUNCEMENT (Soft Delete)
 */
exports.deleteAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;
        const employee_id = req.user.id;

        const { error } = await supabase
            .from('announcements')
            .update({ is_deleted: true })
            .eq('id', id);

        if (error) throw error;

        await auditService.logAction({
            action: 'ANNOUNCEMENT_DELETE',
            user_id: employee_id,
            metadata: { announcement_id: id },
            ip: req.ip
        });

        res.json({ msg: 'Announcement archived' });
    } catch (err) {
        logger.error(`Delete Announcement Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

/**
 * Helper: Triggers notifications for relevant users
 */
async function triggerAnnouncementNotifications(announcement, sender_id) {
    const payload = {
        sender_id,
        title: `📣 ${announcement.title}`,
        message: announcement.summary || 'A new official announcement has been published.',
        type: 'SYSTEM',
        priority: announcement.priority,
        link: `/announcements/${announcement.id}`
    };

    if (announcement.target_all) {
        // Broad notification logic would go here if needed, 
        // for now we trust the feed sync, but could notify active users
    } else {
        // Targeted notification to specific departments
        for (const deptId of announcement.target_departments) {
            await notificationService.notifyDepartment({
                ...payload,
                department_id: deptId
            });
        }
    }
}
