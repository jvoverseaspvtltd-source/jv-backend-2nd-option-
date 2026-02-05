const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');

/**
 * GET /api/cancelled-rejected
 * Fetches all cancelled, rejected, withdrawn, and soft-deleted records.
 * EXCLUDES: admission_status = 'SUCCESS' (protected from deletion)
 * Supports status filtering via query parameter: ?filter=CANCELLED
 */
exports.getCancelledRejected = async (req, res) => {
    try {
        const { id: employee_id, role, dept: employee_dept } = req.user || {};
        const uRole = role?.toUpperCase();
        const isSuperAdmin = uRole === 'SUPER_ADMIN';
        const { filter } = req.query; // Optional: CANCELLED, REJECTED, WITHDRAWN, SOFT_DELETED

        // 1. Fetch Status-Based Registrations (CANCELLED, REJECTED, WITHDRAWN) - NOT soft-deleted
        let statusRegQuery = supabase
            .from('registrations')
            .select('*')
            .in('admission_status', ['CANCELLED', 'REJECTED', 'WITHDRAWN'])
            .eq('is_deleted', false);

        if (!isSuperAdmin) {
            // Only allow Admission and WFH admins to see registrations
            const allowedDepts = ['ADMN', 'ADMISSION', 'WFH'];
            if (!allowedDepts.includes(employee_dept?.toUpperCase())) {
                statusRegQuery = statusRegQuery.eq('id', '00000000-0000-0000-0000-000000000000');
            }
        }
        const { data: statusRegs, error: statusRegError } = await statusRegQuery;
        if (statusRegError) throw statusRegError;

        // 2. Fetch Soft-Deleted Registrations (EXCLUDE SUCCESS)
        let deletedRegQuery = supabase
            .from('registrations')
            .select('*')
            .eq('is_deleted', true)
            .neq('admission_status', 'SUCCESS'); // CRITICAL: Protect successful admissions

        if (!isSuperAdmin) {
            const allowedDepts = ['ADMN', 'ADMISSION', 'WFH'];
            if (!allowedDepts.includes(employee_dept?.toUpperCase())) {
                deletedRegQuery = deletedRegQuery.eq('id', '00000000-0000-0000-0000-000000000000');
            }
        }
        const { data: deletedRegs, error: deletedRegError } = await deletedRegQuery;
        if (deletedRegError) throw deletedRegError;

        // 3. Fetch Soft-Deleted Announcements
        let annQuery = supabase.from('announcements').select('*').eq('is_deleted', true);
        if (!isSuperAdmin && employee_dept) {
            const { data: dept, error: deptLookupError } = await supabase
                .from('departments')
                .select('id')
                .eq('code', employee_dept.toUpperCase())
                .maybeSingle();

            if (deptLookupError) {
                logger.error(`getCancelledRejected Announcement Dept Lookup Error: ${deptLookupError.message}`);
                annQuery = annQuery.eq('target_all', true);
            } else if (dept) {
                // Announcements can target multiple departments using an array field
                // Adjust this filter based on your schema (using JSONB or array)
                annQuery = annQuery.or(`target_all.eq.true,target_departments.cs.{${dept.id}}`);
            } else {
                annQuery = annQuery.eq('target_all', true);
            }
        }
        const { data: annTrash, error: annError } = await annQuery;
        if (annError) {
            logger.error(`getCancelledRejected Announcement Query Error: ${annError.message}`);
            // Don't throw, just use empty array
        }

        // 4. Fetch Rejected & Soft-Deleted Leads
        // FIX: Include leads that are REJECTED but not is_deleted
        let leadQuery = supabase
            .from('leads')
            .select('*')
            .or('is_deleted.eq.true,status.eq.REJECTED,status.eq.CANCELLED');

        if (!isSuperAdmin) {
            const deptId = req.user.departmentId || req.user.department_id;
            if (deptId) {
                leadQuery = leadQuery.eq('department_id', deptId);
            } else if (employee_dept) {
                const { data: dept } = await supabase
                    .from('departments')
                    .select('id')
                    .eq('code', employee_dept.toUpperCase())
                    .maybeSingle();

                if (dept) {
                    leadQuery = leadQuery.eq('department_id', dept.id);
                } else {
                    leadQuery = leadQuery.eq('id', '00000000-0000-0000-0000-000000000000');
                }
            }
        }
        const { data: leadTrash, error: leadError } = await leadQuery;
        if (leadError) {
            logger.error(`getCancelledRejected Lead Query Error: ${leadError.message}`);
            // Don't throw, just use empty array
        }

        // 5. Combine and Format with Status and Reason
        const combined = [
            // Status-based registrations (CANCELLED, REJECTED, WITHDRAWN)
            ...(statusRegs || []).map(item => ({
                id: item.id,
                item_type: 'REGISTRATION',
                status: item.admission_status,
                title: item.name || 'Untitled Registration',
                reason: item.cancellation_reason || item.rejection_reason || 'No reason provided',
                deleted_at: item.updated_at,
                is_soft_deleted: false,
                original_data: item
            })),
            // Soft-deleted registrations (excluding SUCCESS)
            ...(deletedRegs || []).map(item => ({
                id: item.id,
                item_type: 'REGISTRATION',
                status: 'SOFT_DELETED',
                title: item.name || 'Untitled Registration',
                reason: 'Soft-deleted by admin',
                deleted_at: item.deleted_at || item.updated_at,
                is_soft_deleted: true,
                original_data: item
            })),
            // Soft-deleted announcements
            ...(annTrash || []).map(item => ({
                id: item.id,
                item_type: 'ANNOUNCEMENT',
                status: 'SOFT_DELETED',
                title: item.title || 'Untitled Announcement',
                reason: 'Soft-deleted by admin',
                deleted_at: item.updated_at,
                is_soft_deleted: true,
                original_data: item
            })),
            // Soft-deleted & Rejected leads
            ...(leadTrash || []).map(item => ({
                id: item.id,
                item_type: 'LEAD',
                status: item.is_deleted ? 'SOFT_DELETED' : item.status,
                title: item.name || 'Untitled Lead',
                reason: item.is_deleted ? 'Soft-deleted by admin' : (item.rejection_details?.reason || 'No reason provided'),
                deleted_at: item.is_deleted ? (item.deleted_at || item.updated_at) : (item.rejection_details?.at || item.updated_at),
                is_soft_deleted: item.is_deleted,
                original_data: item
            }))
        ];

        // 6. Apply filter if provided
        let filtered = combined;
        if (filter) {
            filtered = combined.filter(item => item.status === filter.toUpperCase());
        }

        // 7. Sort by deleted_at DESC (newest first)
        filtered.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

        res.json(filtered);
    } catch (err) {
        logger.error(`getCancelledRejected Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to fetch cancelled/rejected items', error: err.message });
    }
};

/**
 * POST /api/cancelled-rejected/restore/:id
 * Restores a specific record based on item type.
 */
exports.restoreItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // Expecting 'REGISTRATION', 'ANNOUNCEMENT', or 'LEAD'

        if (!type) {
            return res.status(400).json({ msg: 'Item type is required for restoration' });
        }

        let table = 'announcements';
        if (type === 'REGISTRATION') table = 'registrations';
        if (type === 'LEAD') table = 'leads';

        const { data, error } = await supabase
            .from(table)
            .update({
                is_deleted: false,
                deleted_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            action: 'ITEM_RESTORED',
            user_id: req.user.id,
            metadata: { item_id: id, item_type: type },
            ip: req.ip
        });

        res.json({ msg: 'Item restored successfully', data });
    } catch (err) {
        logger.error(`restoreItem Error: ${err.message}`);
        res.status(500).json({ msg: 'Restoration failed', error: err.message });
    }
};

/**
 * DELETE /api/cancelled-rejected/purge/:id
 * Permanently deletes a record from the database.
 * ONLY Super Admin can purge.
 */
exports.purgeItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body;

        if (req.user.role?.toUpperCase() !== 'SUPER_ADMIN') {
            return res.status(403).json({ msg: 'Only Super Admin can permanently purge records' });
        }

        if (!type) {
            return res.status(400).json({ msg: 'Item type is required for purging' });
        }

        let purgeTable = 'announcements';
        if (type === 'REGISTRATION') purgeTable = 'registrations';
        if (type === 'LEAD') purgeTable = 'leads';

        const { error } = await supabase
            .from(purgeTable)
            .delete()
            .eq('id', id);

        if (error) throw error;

        await auditService.logAction({
            action: 'ITEM_PURGED',
            user_id: req.user.id,
            metadata: { item_id: id, item_type: type },
            ip: req.ip
        });

        res.json({ msg: 'Item permanently purged from system' });
    } catch (err) {
        logger.error(`purgeItem Error: ${err.message}`);
        res.status(500).json({ msg: 'Purge failed', error: err.message });
    }
};
