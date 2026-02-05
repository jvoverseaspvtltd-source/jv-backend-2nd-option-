const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

// @route   POST api/queries
// @desc    Create a new query (Student)
// @access  Authenticated (Student)
exports.createQuery = async (req, res) => {
    try {
        const { title, description, category } = req.body;
        const studentId = req.user.registrationId || req.user.id; // Adapt based on auth user structure

        if (!title || !category) {
            return res.status(400).json({ msg: 'Title and Category are required' });
        }

        // 1. Create the Query
        const { data: query, error: queryError } = await supabase
            .from('student_queries')
            .insert({
                student_id: studentId,
                title,
                description,
                category,
                status: 'Open'
            })
            .select()
            .single();

        if (queryError) throw queryError;

        // 2. Add initial system message or description as first message?
        // Let's add the description as the first message from the student if provided
        if (description) {
            await supabase.from('query_messages').insert({
                query_id: query.id,
                sender_role: 'STUDENT',
                sender_id: studentId,
                message: description
            });
        }

        // 3. Log Action (Optional)
        // logger.info(`New Query Created: ${query.id} by ${studentId}`);

        res.json({ success: true, query });
    } catch (err) {
        logger.error(`createQuery Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET api/queries
// @desc    Get all queries (Filtered by role)
// @access  Authenticated
exports.getQueries = async (req, res) => {
    try {
        const { status, category, assigned_to, date } = req.query;
        let query = supabase.from('student_queries').select('*, registrations(name, email, phone)');

        // Role-based filtering
        if (req.user.role === 'STUDENT') {
            // Students only see their own
            query = query.eq('student_id', req.user.registrationId || req.user.id);
        } else {
            // Employees see all, can filter
            if (status) query = query.eq('status', status);
            if (category) query = query.eq('category', category);
            if (assigned_to === 'me') query = query.eq('assigned_to', req.user.id);

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
        logger.error(`getQueries Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET api/queries/:id
// @desc    Get single query with messages
// @access  Authenticated
exports.getQueryDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Get Query Info
        const { data: queryData, error: queryError } = await supabase
            .from('student_queries')
            .select('*, registrations(name, email)')
            .eq('id', id)
            .single();

        if (queryError) throw queryError;
        if (!queryData) return res.status(404).json({ msg: 'Query not found' });

        // Security Check: Students can only view their own
        if (req.user.role === 'STUDENT' && queryData.student_id !== (req.user.registrationId || req.user.id)) {
            return res.status(403).json({ msg: 'Access Denied' });
        }

        // 2. Get Messages
        const { data: messages, error: msgError } = await supabase
            .from('query_messages')
            .select('*')
            .eq('query_id', id)
            .order('created_at', { ascending: true });

        if (msgError) throw msgError;

        res.json({ query: queryData, messages });
    } catch (err) {
        logger.error(`getQueryDetails Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   POST api/queries/:id/messages
// @desc    Send a message
// @access  Authenticated
exports.sendMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const senderRole = req.user.role === 'STUDENT' ? 'STUDENT' : 'EMPLOYEE';
        const senderId = req.user.id; // Or registrationId for student

        if (!message) return res.status(400).json({ msg: 'Message is required' });

        // 1. Insert Message
        const { data: msgData, error: msgError } = await supabase
            .from('query_messages')
            .insert({
                query_id: id,
                sender_role: senderRole,
                sender_id: senderId,
                message
            })
            .select()
            .single();

        if (msgError) throw msgError;

        // 2. Update Query metadata (last_message_at, assigned_to if employee replies)
        const updatePayload = {
            last_message_at: new Date().toISOString()
        };

        // Auto-assign logic: If currently unassigned and an employee replies, assign to them
        if (senderRole === 'EMPLOYEE') {
            const { data: currentQuery } = await supabase.from('student_queries').select('assigned_to').eq('id', id).single();
            if (currentQuery && !currentQuery.assigned_to) {
                updatePayload.assigned_to = senderId;
                updatePayload.status = 'In Progress'; // Auto update status
            }
        } else if (senderRole === 'STUDENT') {
            // If student replies, maybe mark as Open again if it was Resolved? 
            // Logic can be refined later.
        }

        await supabase.from('student_queries').update(updatePayload).eq('id', id);

        res.json({ success: true, message: msgData });
    } catch (err) {
        logger.error(`sendMessage Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PATCH api/queries/:id
// @desc    Update status or assign
// @access  Authenticated (Employee)
exports.updateQuery = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, assigned_to } = req.body;

        if (req.user.role === 'STUDENT') {
            return res.status(403).json({ msg: 'Students cannot update query settings' });
        }

        const updatePayload = {};
        if (status) updatePayload.status = status;
        if (assigned_to) updatePayload.assigned_to = assigned_to;

        const { data, error } = await supabase
            .from('student_queries')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, query: data });
    } catch (err) {
        logger.error(`updateQuery Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};
