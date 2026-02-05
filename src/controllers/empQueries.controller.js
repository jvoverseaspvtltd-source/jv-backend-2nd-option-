const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * RBAC Helper: Define category permissions
 * In a real system, this could be in a DB table or config.
 */
const CATEGORY_PERMISSIONS = {
    'HR': ['HR_ADMIN', 'SUPER_ADMIN'],
    'IT': ['IT_ADMIN', 'SUPER_ADMIN'],
    'Finance': ['FINANCE_ADMIN', 'SUPER_ADMIN'],
    'Management': ['SUPER_ADMIN']
};

/**
 * Returns true if the user has permission to manage a category.
 */
const canManageCategory = (user, category) => {
    if (user.role === 'SUPER_ADMIN' || user.dept === 'ADMIN') return true;

    // Check if user is an admin for their specific department
    // user.dept contains the code (e.g. 'HR', 'IT', 'FIN')
    const userRole = (user.role || '').toUpperCase();
    const userDept = (user.dept || '').toUpperCase();

    if (userRole.endsWith('_ADMIN')) {
        if (category === 'HR' && userDept === 'HR') return true;
        if (category === 'IT' && userDept === 'IT') return true;
        if (category === 'Finance' && userDept === 'FINANCE') return true;
        if (category === 'Management' && userDept === 'ADMIN') return true;
    }

    return false;
};

// @route   POST api/emp-queries
// @desc    Create a new internal query (Employee)
exports.createEmpQuery = async (req, res) => {
    try {
        const { title, category, priority, description } = req.body;
        const employeeId = req.user.id;

        if (!title || !category) {
            return res.status(400).json({ msg: 'Title and Category are required' });
        }

        // 1. Create the Query
        const { data: query, error: queryError } = await supabase
            .from('employee_queries')
            .insert({
                creator_id: employeeId,
                title,
                category,
                priority: priority || 'Medium',
                status: 'Open'
            })
            .select()
            .single();

        if (queryError) throw queryError;

        // 2. Add description as first message
        if (description) {
            await supabase.from('employee_query_messages').insert({
                query_id: query.id,
                sender_id: employeeId,
                message: description
            });
        }

        res.json({ success: true, query });
    } catch (err) {
        logger.error(`createEmpQuery Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET api/emp-queries
// @desc    Get internal queries (Filtered by role/category)
exports.getEmpQueries = async (req, res) => {
    try {
        const { status, category, date } = req.query;
        const user = req.user;
        let query = supabase.from('employee_queries').select('*, creator:employees!employee_queries_creator_id_fkey(name, email, departments(code))');

        const isSuperAdmin = user.role === 'SUPER_ADMIN';
        const isAdmin = user.role.endsWith('_ADMIN');

        if (!isAdmin && !isSuperAdmin) {
            // Normal employees see only their own
            query = query.eq('creator_id', user.id);
        } else {
            // Admins see all for their permitted categories
            if (!isSuperAdmin) {
                // Determine permitted categories based on dept code
                const dept = user.dept.toUpperCase();
                if (dept === 'HR') query = query.eq('category', 'HR');
                else if (dept === 'IT') query = query.eq('category', 'IT');
                else if (dept === 'FINANCE') query = query.eq('category', 'Finance');
                else if (dept === 'ADMIN') { /* sees all */ }
                else {
                    // Other admins see only their own unless they are HR/IT/Finance/Admin
                    query = query.eq('creator_id', user.id);
                }
            }

            // Apply Filters
            if (status) query = query.eq('status', status);
            if (category) query = query.eq('category', category);
            if (date) {
                const start = `${date}T00:00:00.000Z`;
                const end = `${date}T23:59:59.999Z`;
                query = query.gte('created_at', start).lte('created_at', end);
            }
        }

        query = query.order('last_message_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;

        res.json(data);
    } catch (err) {
        logger.error(`getEmpQueries Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET api/emp-queries/:id
exports.getEmpQueryDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        // 1. Get Query Info
        const { data: queryData, error: queryError } = await supabase
            .from('employee_queries')
            .select('*, creator:employees!employee_queries_creator_id_fkey(name, email, departments(code))')
            .eq('id', id)
            .single();

        if (queryError) throw queryError;
        if (!queryData) return res.status(404).json({ msg: 'Query not found' });

        // Security Check
        const isOwner = queryData.creator_id === user.id;
        const hasAccess = isOwner || canManageCategory(user, queryData.category);

        if (!hasAccess) {
            return res.status(403).json({ msg: 'Access Denied' });
        }

        // 2. Get Messages
        const { data: messages, error: msgError } = await supabase
            .from('employee_query_messages')
            .select('*, sender:employees!employee_query_messages_sender_id_fkey(name, role, departments(code))')
            .eq('query_id', id)
            .order('created_at', { ascending: true });

        if (msgError) throw msgError;

        res.json({ query: queryData, messages });
    } catch (err) {
        logger.error(`getEmpQueryDetails Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   POST api/emp-queries/:id/messages
exports.sendEmpMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const user = req.user;

        if (!message) return res.status(400).json({ msg: 'Message is required' });

        // 1. Check Query status and access
        const { data: query, error: queryError } = await supabase
            .from('employee_queries')
            .select('*')
            .eq('id', id)
            .single();

        if (queryError || !query) return res.status(404).json({ msg: 'Query not found' });

        // Resolved State Lockout
        if (query.status === 'Resolved' && user.id === query.creator_id) {
            return res.status(403).json({ msg: 'Cannot send messages to a resolved query' });
        }

        // Security Check
        const hasAccess = query.creator_id === user.id || canManageCategory(user, query.category);
        if (!hasAccess) return res.status(403).json({ msg: 'Access Denied' });

        // 2. Insert Message
        const { data: msgData, error: msgError } = await supabase
            .from('employee_query_messages')
            .insert({
                query_id: id,
                sender_id: user.id,
                message
            })
            .select()
            .single();

        if (msgError) throw msgError;

        // 3. Update Query metadata
        const updatePayload = {
            last_message_at: new Date().toISOString()
        };

        // Auto-assign if an admin replies and it's unassigned
        if (canManageCategory(user, query.category) && query.creator_id !== user.id) {
            if (!query.assigned_to) {
                updatePayload.assigned_to = user.id;
                updatePayload.status = 'In Progress';
            }
        }

        await supabase.from('employee_queries').update(updatePayload).eq('id', id);

        res.json({ success: true, message: msgData });
    } catch (err) {
        logger.error(`sendEmpMessage Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PATCH api/emp-queries/:id
exports.updateEmpQuery = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, assigned_to, priority } = req.body;
        const user = req.user;

        const { data: queryData, error: fetchError } = await supabase
            .from('employee_queries')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !queryData) return res.status(404).json({ msg: 'Query not found' });

        // Access Check: Only Admins of the category can update query settings
        if (!canManageCategory(user, queryData.category)) {
            return res.status(403).json({ msg: 'Access Denied: Admin only' });
        }

        // Workflow Enforcement: Only Admin can resolve
        const updatePayload = {};
        if (status) updatePayload.status = status;
        if (assigned_to) updatePayload.assigned_to = assigned_to;
        if (priority) updatePayload.priority = priority;

        const { data, error } = await supabase
            .from('employee_queries')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, query: data });
    } catch (err) {
        logger.error(`updateEmpQuery Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};
