const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');

// ============================================================================
// DASHBOARD & REGISTRATIONS
// ============================================================================

// @route   GET api/field-agent/dashboard
exports.getDashboardStats = async (req, res) => {
    try {
        // Total students assigned to this field agent
        const { count: totalAssigned, error: totalError } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_field_agent_id', req.user.id)
            .eq('is_deleted', false);

        // Pending loan documents (students with loan_status != 'VERIFIED')
        const { count: pendingDocs, error: pendingError } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_field_agent_id', req.user.id)
            .neq('loan_status', 'VERIFIED')
            .eq('is_deleted', false);

        // Successfully transferred to Veda Loans
        const { count: successCount, error: successError } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_field_agent_id', req.user.id)
            .eq('is_transferred_to_veda', true);

        // Tasks pending vs completed for this agent
        const { count: pendingTasks, error: taskPendingError } = await supabase
            .from('field_agent_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_to', req.user.id)
            .neq('status', 'COMPLETED');

        if (totalError || pendingError || successError || taskPendingError) {
            throw totalError || pendingError || successError || taskPendingError;
        }

        res.json({
            totalAssignedStudents: totalAssigned || 0,
            pendingLoanDocuments: pendingDocs || 0,
            successfullyTransferred: successCount || 0,
            pendingTasks: pendingTasks || 0
        });
    } catch (err) {
        logger.error(`getFieldAgentStats Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET api/field-agent/registrations
exports.getRegistrations = async (req, res) => {
    try {
        const { trash } = req.query;
        let query = supabase.from('registrations').select(`
            *,
            admission_info:employees!assigned_field_agent_id(id, name)
        `);

        if (trash === 'true') {
            query = query.eq('is_deleted', true);
        } else {
            query = query.eq('is_deleted', false);
        }

        // Only show students assigned to this agent or students who are ready for field agent (sent from admission)
        // For now, filtering by assigned_field_agent_id
        if (req.user.role !== 'SUPER_ADMIN' && req.user.department !== 'ADMIN') {
            query = query.eq('assigned_field_agent_id', req.user.id);
        }

        const { data: registrations, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        // Flatten workflow fields for frontend compatibility
        const flattened = registrations.map(r => ({
            ...r,
            fullName: r.name,
            full_name: r.name,
            loanOpted: r.workflow?.loanOpted,
            preferredCountry: r.workflow?.preferredCountry,
            dob: r.workflow?.dob
        }));

        res.json(flattened);
    } catch (err) {
        logger.error(`getFieldAgentRegistrations Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// LOAN DOCUMENTS
// ============================================================================

// @route   GET api/field-agent/registrations/:id/documents
exports.getLoanDocuments = async (req, res) => {
    try {
        const { data: documents, error } = await supabase
            .from('loan_documents')
            .select('*')
            .eq('registration_id', req.params.id);

        if (error) throw error;
        res.json(documents);
    } catch (err) {
        logger.error(`getLoanDocuments Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/field-agent/registrations/:id/documents
exports.uploadLoanDocument = async (req, res) => {
    try {
        const { documentType, documentName, fileUrl } = req.body;
        const { data: document, error } = await supabase
            .from('loan_documents')
            .insert({
                registration_id: req.params.id,
                document_type: documentType,
                document_name: documentName,
                file_url: fileUrl,
                status: 'UPLOADED',
                uploaded_by: req.user.id
            })
            .select()
            .single();

        if (error) throw error;

        // Update registration loan status to IN_PROGRESS if it was NOT_STARTED
        await supabase
            .from('registrations')
            .update({ loan_status: 'IN_PROGRESS', updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('loan_status', 'NOT_STARTED');

        res.json(document);
    } catch (err) {
        logger.error(`uploadLoanDocument Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/field-agent/documents/:docId/status
exports.updateDocumentStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        const { data: document, error } = await supabase
            .from('loan_documents')
            .update({
                status: status,
                remarks: remarks || '',
                verified_by: req.user.id,
                verified_at: status === 'VERIFIED' ? new Date().toISOString() : null,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.docId)
            .select()
            .single();

        if (error) throw error;
        res.json(document);
    } catch (err) {
        logger.error(`updateDocumentStatus Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/field-agent/registrations/:id/transfer-veda
exports.transferToVeda = async (req, res) => {
    try {
        // 1. Check if all mandatory docs are verified (Simplified for now)
        const { data: unverifiedDocs, error: checkError } = await supabase
            .from('loan_documents')
            .select('id')
            .eq('registration_id', req.params.id)
            .neq('status', 'VERIFIED');

        if (checkError) throw checkError;

        // This is a business rule check
        // if (unverifiedDocs.length > 0) {
        //     return res.status(400).json({ msg: 'Please verify all documents before transferring to Veda Loans' });
        // }

        const { data: registration, error: regError } = await supabase
            .from('registrations')
            .update({
                is_transferred_to_veda: true,
                transferred_to_veda_at: new Date().toISOString(),
                loan_status: 'VERIFIED',
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (regError) throw regError;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'CASE_TRANSFERRED_TO_VEDA',
            metadata: { regId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Case successfully transferred to Veda Loans', registration });
    } catch (err) {
        logger.error(`transferToVeda Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// TASK MANAGEMENT
// ============================================================================

// @route   GET api/field-agent/tasks
exports.getTasks = async (req, res) => {
    try {
        const { status, type } = req.query;
        let query = supabase.from('field_agent_tasks').select(`
            *,
            assigned_to_info:employees!assigned_to(id, name, email),
            assigned_by_info:employees!assigned_by(id, name, email)
        `);

        if (type === 'assigned') {
            query = query.eq('assigned_to', req.user.id).neq('status', 'COMPLETED');
        } else if (type === 'completed') {
            query = query.eq('assigned_to', req.user.id).eq('status', 'COMPLETED');
        }

        if (status) query = query.eq('status', status);

        const { data: tasks, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(tasks);
    } catch (err) {
        logger.error(`getFieldAgentTasks Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/field-agent/tasks
exports.createTask = async (req, res) => {
    try {
        const { title, description, assignedTo, priority, dueDate, registrationId } = req.body;
        const { data: task, error } = await supabase
            .from('field_agent_tasks')
            .insert({
                title,
                description,
                assigned_to: assignedTo,
                assigned_by: req.user.id,
                registration_id: registrationId,
                priority: priority || 'MEDIUM',
                due_date: dueDate,
                status: 'PENDING'
            })
            .select()
            .single();

        if (error) throw error;
        res.json(task);
    } catch (err) {
        logger.error(`createFieldAgentTask Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/field-agent/tasks/:id/status
exports.updateTaskStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const updateData = { status, updated_at: new Date().toISOString() };
        if (status === 'COMPLETED') updateData.completed_at = new Date().toISOString();

        const { data: task, error } = await supabase
            .from('field_agent_tasks')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(task);
    } catch (err) {
        logger.error(`updateFieldAgentTaskStatus Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};
