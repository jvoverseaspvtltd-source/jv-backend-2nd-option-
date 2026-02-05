const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const emailService = require('../services/email.service');
const pdfService = require('../services/pdf.service');
const validationService = require('../services/validation.service');
const workflowService = require('../services/workflow.service');
const { generateStudentId } = require('../utils/generators');
const bcrypt = require('bcryptjs');

// @route   POST api/crm/leads
// @desc    Create a new lead (Manual add)
exports.createLead = async (req, res) => {
    try {
        const {
            name, fatherName, email, phone, qualification,
            district, state, pincode, gender, category, sourceType
        } = req.body;

        if (!name || !fatherName || !phone || !district || !state) {
            return res.status(400).json({
                error: 'Validation Failed',
                details: 'Name, Father Name, Phone, District, and State are required fields',
                fields: { name: !name, fatherName: !fatherName, phone: !phone, district: !district, state: !state }
            });
        }

        // Strict Phone Validation
        if (!validationService.validatePhone(phone)) {
            return res.status(400).json({ error: 'Validation Failed', details: 'Mobile number must be exactly 10 digits without any special characters or letters' });
        }

        // Strict Email Validation (if provided)
        if (email && !validationService.validateEmail(email)) {
            return res.status(400).json({ error: 'Validation Failed', details: 'Please provide a valid email address' });
        }

        // Strict Pincode Validation (if provided)
        if (pincode && !validationService.validatePincode(pincode)) {
            return res.status(400).json({ error: 'Validation Failed', details: 'Pincode must be exactly 6 digits' });
        }

        // Counsellor logic: Auto-assign to self
        const isCounsellor = req.user.role === 'counsellor';

        const insertData = {
            name,
            father_name: fatherName,
            email: email ? validationService.normalizeEmail(email) : null,
            phone,
            qualification,
            district,
            state,
            pincode,
            gender,
            category,
            source_type: sourceType || 'Own Lead',
            added_by: req.user.id,
            department_id: req.user.departmentId,
            status: 'ACTIVE'
        };

        // If added by counsellor, auto-assign
        if (isCounsellor) {
            insertData.assigned_to = req.user.id;
            insertData.is_assigned = true;
            insertData.assigned_at = new Date().toISOString();
        }

        const { data: lead, error } = await supabase
            .from('leads')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            logger.error(`Supabase createLead Error: ${error.message}`, { error });
            return res.status(500).json({ error: 'Database Error', details: error.message });
        }

        // Audit Log
        await supabase.from('lead_audit_logs').insert({
            lead_id: lead.id,
            action: 'ADD',
            performed_by: req.user.id,
            new_values: lead
        });

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_CREATED',
            metadata: { leadId: lead.id, autoAssigned: isCounsellor },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(lead);
    } catch (err) {
        logger.error(`createLead Error: ${err.message}`);
        res.status(500).json({ error: 'Server Error', details: err.message });
    }
};

// @route   PUT api/crm/leads/:id
// @desc    Update lead details (With restrictions and audit)
exports.updateLead = async (req, res) => {
    try {
        const {
            email, phone, qualification, district, state,
            pincode, gender, category, status
        } = req.body;

        // Fetch old data for audit
        const { data: oldLead } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
        if (!oldLead) return res.status(404).json({ msg: 'Lead not found' });

        if (pincode && !validationService.validatePincode(pincode)) {
            return res.status(400).json({ msg: 'Pincode must be exactly 6 digits' });
        }

        const updateData = {
            email: email ? validationService.normalizeEmail(email) : oldLead.email,
            phone: phone || oldLead.phone,
            qualification: qualification || oldLead.qualification,
            district: district || oldLead.district,
            state: state || oldLead.state,
            pincode: pincode || oldLead.pincode,
            gender: gender || oldLead.gender,
            category: category || oldLead.category,
            status: status || oldLead.status,
            updated_at: new Date().toISOString()
        };

        const { data: updatedLead, error } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        // Audit Log
        await supabase.from('lead_audit_logs').insert({
            lead_id: req.params.id,
            action: 'EDIT',
            performed_by: req.user.id,
            old_values: oldLead,
            new_values: updatedLead
        });

        res.json(updatedLead);
    } catch (err) {
        logger.error(`updateLead Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

const maskingUtils = require('../utils/masking');

// @route   GET api/crm/leads/:id
// @desc    Get lead details by ID (with Data Masking)
exports.getLeadById = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('leads')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ msg: 'Lead not found' });
            }
            throw error;
        }

        // Apply Data Masking
        const maskedData = maskingUtils.maskData(data, req.user.role);

        // Audit Log for Access (Compliance)
        // Log even if it's a "Read" - strictly for WFH/Restricted roles monitoring
        if (!['super_admin', 'admin', 'counselling_admin'].includes(req.user.role)) {
            await auditService.logAction({
                employeeId: req.user.id,
                action: 'LEAD_VIEW',
                metadata: { leadId: req.params.id, masked: true },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        }

        res.json(maskedData);
    } catch (err) {
        logger.error(`getLeadById Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/leads/bulk
// @desc    Bulk upload leads from CSV/Excel data
exports.bulkUploadLeads = async (req, res) => {
    try {
        const { leads } = req.body; // Expecting array of objects

        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ msg: 'No data provided for bulk upload' });
        }

        const validLeads = leads.filter(l => validationService.validatePhone(l.phone));

        if (validLeads.length === 0) {
            return res.status(400).json({ msg: 'No leads with valid 10-digit mobile numbers found' });
        }

        const formattedLeads = validLeads.map(l => ({
            name: l.name,
            father_name: l.fatherName,
            email: (l.email && validationService.validateEmail(l.email))
                ? validationService.normalizeEmail(l.email)
                : 'NA',
            phone: l.phone,
            qualification: l.qualification,
            district: l.district,
            state: l.state,
            pincode: (l.pincode && validationService.validatePincode(l.pincode)) ? l.pincode : '000000',
            gender: l.gender,
            category: l.category,
            source_type: l.sourceType || 'Bulk Upload',
            added_by: req.user.id,
            department_id: req.user.departmentId,
            status: 'ACTIVE',
            is_assigned: false
        }));

        const { data, error } = await supabase.from('leads').insert(formattedLeads).select();

        if (error) throw error;

        // Audit Bulk Action
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'BULK_LEAD_UPLOAD',
            metadata: { count: data.length },
            ip: req.ip
        });

        res.json({ msg: `Successfully uploaded ${data.length} leads`, count: data.length });
    } catch (err) {
        logger.error(`bulkUploadLeads Error: ${err.message}`);
        res.status(500).json({ error: 'Bulk Upload Failed', details: err.message });
    }
};

// @route   GET api/crm/leads/:id/audit
exports.getLeadAuditLogs = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('lead_audit_logs')
            .select(`
                *,
                performed_by_info:employees(name)
            `)
            .eq('lead_id', req.params.id)
            .order('timestamp', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        logger.error(`getLeadAuditLogs Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/leads/general
// @desc    Fetch all unassigned leads with pagination (Masked)
exports.getGeneralLeads = async (req, res) => {
    try {
        const { search, source, showAll } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('leads')
            .select('*', { count: 'exact' })
            .eq('is_deleted', false);

        // If not showing all, only show unassigned
        if (showAll !== 'true') {
            query = query.eq('is_assigned', false);
            // FIX: Exclude Rejected/Converted leads from the general pool
            query = query.neq('status', 'REJECTED');
            query = query.neq('status', 'CONVERTED');
        }

        // Apply filters
        if (search) {
            query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,district.ilike.%${search}%`);
        }

        if (source && source !== 'All') {
            query = query.eq('source_type', source);
        }

        const { data: leads, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Apply Data Masking
        const maskedLeads = maskingUtils.maskData(leads, req.user.role);

        res.json({
            leads: maskedLeads,
            total: count,
            page,
            limit
        });
    } catch (err) {
        logger.error(`getGeneralLeads Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/leads/my-leads
// @desc    Fetch leads assigned to the logged-in counsellor with pagination (Masked)
exports.getMyLeads = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const offset = (page - 1) * limit;

        // Fetch leads sorted by assignment age (oldest first for priority)
        let query = supabase
            .from('leads')
            .select('*', { count: 'exact' })
            .eq('assigned_to', req.user.id)
            .eq('is_deleted', false)
            .neq('status', 'REJECTED') // Exclude rejected leads
            .neq('status', 'FOLLOW_UP'); // Exclude leads currently in follow-up flow

        // Filter out Converted leads by default unless specifically requested
        if (req.query.includeConverted !== 'true') {
            query = query.neq('status', 'CONVERTED');
        }

        const { data: leads, error, count } = await query
            .order('assigned_at', { ascending: true }) // OLDEST FIRST - Lead Aging Priority
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Apply Data Masking FIRST
        const maskedLeads = maskingUtils.maskData(leads, req.user.role);

        // Calculate lead age for each lead
        const leadsWithAge = maskedLeads.map(lead => {
            const assignedAt = new Date(lead.assigned_at || lead.created_at);
            const now = new Date();
            const ageInHours = Math.floor((now - assignedAt) / (1000 * 60 * 60));
            const ageInDays = Math.floor(ageInHours / 24);

            return {
                ...lead,
                assigned_at: lead.assigned_at || lead.created_at,
                age_hours: ageInHours,
                age_days: ageInDays,
                priority: ageInHours < 24 ? 'fresh' : ageInHours < 48 ? 'warming' : 'hot'
            };
        });

        res.json({
            leads: leadsWithAge,
            total: count,
            page,
            limit
        });
    } catch (err) {
        logger.error(`getMyLeads Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/leads/my-follow-ups
// @desc    Fetch leads with pending follow-ups assigned to the logged-in counsellor
exports.getMyFollowUps = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const offset = (page - 1) * limit;

        // Fetch all leads for this counsellor that have follow_ups
        const { data: leads, error } = await supabase
            .from('leads')
            .select('*')
            .eq('assigned_to', req.user.id)
            .eq('is_deleted', false)
            .eq('status', 'FOLLOW_UP'); // Only show leads explicitly marked for follow-up

        if (error) throw error;

        const now = new Date();

        // 1. Filter leads that have at least one PENDING follow-up
        // 2. Identify the next active follow-up for each lead
        // 3. Attach aging/priority data
        const followUpLeads = leads.filter(lead => {
            const pending = (lead.follow_ups || []).filter(f => f.status === 'PENDING');
            return pending.length > 0;
        }).map(lead => {
            const pending = (lead.follow_ups || [])
                .filter(f => f.status === 'PENDING')
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            const activeFollowUp = pending[0];

            const assignedAt = new Date(lead.assigned_at || lead.created_at);
            const ageInHours = Math.floor((now - assignedAt) / (1000 * 60 * 60));
            const ageInDays = Math.floor(ageInHours / 24);

            return {
                ...lead,
                active_follow_up: activeFollowUp,
                is_overdue: new Date(activeFollowUp.date) < now,
                age_hours: ageInHours,
                age_days: ageInDays,
                priority: ageInHours < 24 ? 'fresh' : ageInHours < 48 ? 'warming' : 'hot'
            };
        });

        // 4. Sort: Overdue first, then nearest upcoming
        // Sorting by date ASC naturally puts past dates first
        const sortedLeads = followUpLeads.sort((a, b) => {
            return new Date(a.active_follow_up.date) - new Date(b.active_follow_up.date);
        });

        // 5. Paginate in memory
        const paginatedLeads = sortedLeads.slice(offset, offset + limit);

        res.json({
            leads: paginatedLeads,
            total: sortedLeads.length,
            page,
            limit
        });
    } catch (err) {
        logger.error(`getMyFollowUps Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/leads/:id/assign
// @desc    Assign a lead to an employee (or self)
exports.assignLead = async (req, res) => {
    try {
        const { employeeId } = req.body;
        const targetId = employeeId || req.user.id;

        const { data: updatedLead, error } = await supabase
            .from('leads')
            .update({
                is_assigned: true,
                assigned_to: targetId,
                assigned_at: new Date().toISOString(),
                status: 'CONTACTED'
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('lead_audit_logs').insert({
            lead_id: req.params.id,
            action: 'ASSIGN',
            performed_by: req.user.id,
            new_values: updatedLead
        });

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_ASSIGNED',
            metadata: { leadId: req.params.id, assignedTo: targetId },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedLead);
    } catch (err) {
        logger.error(`assignLead Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/leads/:id/interaction
// @desc    Complete interaction flow: Log outcome and enforce next action
exports.submitInteraction = async (req, res) => {
    try {
        const { outcome, nextStep, followUpDate, followUpNote, rejectionReason } = req.body;
        const leadId = req.params.id;

        // 1. Fetch current lead data
        const { data: lead, error: fetchError } = await supabase
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .single();

        if (fetchError || !lead) return res.status(404).json({ msg: 'Lead not found' });

        const now = new Date().toISOString();
        const interactionLog = {
            outcome,
            performedBy: req.user.id,
            performedByName: req.user.name,
            timestamp: now,
            details: nextStep === 'FOLLOW_UP' ? `Scheduled next follow-up for ${followUpDate}` :
                nextStep === 'REJECT' ? `Rejected: ${rejectionReason}` :
                    nextStep === 'REGISTER' ? 'Moved to Registration' : 'Interaction logged'
        };

        let updateData = {
            call_logs: [interactionLog, ...(lead.call_logs || [])],
            updated_at: now
        };

        // 2. Handle Next Step Logic
        if (nextStep === 'FOLLOW_UP') {
            const newFollowUp = {
                date: followUpDate,
                note: followUpNote,
                employeeId: req.user.id,
                employeeName: req.user.name,
                status: 'PENDING',
                createdAt: now
            };

            // Mark existing pending follow-ups as COMPLETED since we are scheduling a new one
            const updatedFollowUps = (lead.follow_ups || []).map(f =>
                f.status === 'PENDING' ? { ...f, status: 'COMPLETED', completedAt: now } : f
            );

            updateData.follow_ups = [newFollowUp, ...updatedFollowUps];
            updateData.status = 'FOLLOW_UP'; // Immediate movement to Follow-up list
        } else if (nextStep === 'REJECT') {
            updateData.status = 'REJECTED';
            updateData.is_assigned = false; // Move out of active workspace

            // Tag with current user's department to ensure it shows up in their Trash page
            const deptId = req.user.departmentId || req.user.department_id;
            if (deptId) {
                updateData.department_id = deptId;
            }

            updateData.rejection_details = {
                reason: rejectionReason,
                rejectedBy: req.user.id,
                at: now
            };
            // Mark all pending follow-ups as CANCELLED
            updateData.follow_ups = (lead.follow_ups || []).map(f =>
                f.status === 'PENDING' ? { ...f, status: 'CANCELLED', cancelledAt: now } : f
            );
        } else if (nextStep === 'REGISTER') {
            updateData.status = 'CONVERTING_TO_REG';
            // Mark all pending follow-ups as COMPLETED
            updateData.follow_ups = (lead.follow_ups || []).map(f =>
                f.status === 'PENDING' ? { ...f, status: 'COMPLETED', completedAt: now } : f
            );
        }

        const { data: updatedLead, error: updateError } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', leadId)
            .select()
            .single();

        if (updateError) throw updateError;

        // 3. Audit Logging
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_INTERACTION',
            metadata: {
                leadId,
                outcome,
                nextStep,
                followUpDate
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedLead);
    } catch (err) {
        logger.error(`submitInteraction Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/leads/:id/call-log
exports.addCallLog = async (req, res) => {
    try {
        const { status, note } = req.body;

        const { data: lead, error: fetchError } = await supabase
            .from('leads')
            .select('call_logs, follow_ups') // Fetch both
            .eq('id', req.params.id)
            .single();

        if (fetchError || !lead) return res.status(404).json({ msg: 'Lead not found' });

        const newLog = {
            status,
            note,
            employeeId: req.user.id,
            employeeName: req.user.name,
            timestamp: new Date().toISOString()
        };

        // Smart Feature: Mark the latest pending follow-up as COMPLETED
        const updatedFollowUps = (lead.follow_ups || []).map((f, index) => {
            // Find the most recent pending follow-up
            const sortedPending = (lead.follow_ups || [])
                .filter(fup => fup.status === 'PENDING')
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            if (sortedPending.length > 0 && f.date === sortedPending[0].date && f.status === 'PENDING') {
                return { ...f, status: 'COMPLETED', completedAt: new Date().toISOString() };
            }
            return f;
        });

        const { data: updatedLead, error } = await supabase
            .from('leads')
            .update({
                status: status,
                call_logs: [newLog, ...(lead.call_logs || [])],
                follow_ups: updatedFollowUps // Update follow-ups too
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'CALL_LOG_ADDED',
            metadata: { leadId: req.params.id, status, followUpCompleted: true },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedLead);
    } catch (err) {
        logger.error(`addCallLog Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/leads/:id/follow-up
exports.addFollowUp = async (req, res) => {
    try {
        const { date, note } = req.body;

        const { data: lead, error: fetchError } = await supabase
            .from('leads')
            .select('follow_ups')
            .eq('id', req.params.id)
            .single();

        if (fetchError || !lead) return res.status(404).json({ msg: 'Lead not found' });

        const newFollowUp = {
            date,
            note,
            employeeId: req.user.id,
            employeeName: req.user.name,
            status: 'PENDING',
            createdAt: new Date().toISOString()
        };

        const { data: updatedLead, error } = await supabase
            .from('leads')
            .update({
                follow_ups: [newFollowUp, ...(lead.follow_ups || [])],
                status: 'FOLLOW_UP' // Ensure lead moves to Follow-up list
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'FOLLOW_UP_SCHEDULED',
            metadata: { leadId: req.params.id, date },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedLead);
    } catch (err) {
        logger.error(`addFollowUp Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/leads/:id/register
exports.registerStudent = async (req, res) => {
    try {
        const amount = req.body.amount || req.body.totalAmount || 0;
        const paidAmount = req.body.paidAmount || 0;
        const paymentMethod = req.body.paymentMethod || req.body.paymentMode || 'Cash';
        const loanOpted = req.body.loanOpted || false;
        const intake = req.body.intake;
        const course = req.body.course;
        const country = req.body.country;
        const paymentStatus = req.body.paymentStatus;

        const firstName = req.body.firstName;
        const lastName = req.body.lastName;
        const fullName = firstName && lastName
            ? `${firstName} ${lastName}`
            : req.body.fullName;

        const email = req.body.email;
        const phone = req.body.phone;
        const dob = req.body.dob;

        const { data: lead, error: leadError } = await supabase
            .from('leads')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (leadError || !lead) {
            return res.status(404).json({ error: 'Lead Not Found' });
        }

        const targetEmail = validationService.normalizeEmail(email || lead.email);
        const alreadyRegistered = await validationService.isEmailRegistered(targetEmail, req);

        if (alreadyRegistered) {
            return res.status(400).json({ error: 'EMAIL_ALREADY_REGISTERED' });
        }

        const { count } = await supabase.from('registrations').select('*', { count: 'exact', head: true });
        const studentId = generateStudentId(count || 0);

        const studentFirstName = firstName || fullName.split(' ')[0];
        const plainPassword = `${studentFirstName.toLowerCase()}@jvstudent123`;

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(plainPassword, salt);

        const total = amount || 0;
        const paid = paidAmount || 0;
        const balance = total - paid;
        const finalPaymentStatus = paymentStatus || (balance > 0 ? (paid > 0 ? 'Partial' : 'Pending') : 'Paid');

        const installments = [];
        if (paid > 0) {
            installments.push({
                id: 'PAY-' + Date.now(),
                amount: paid,
                type: 'Registration Fee',
                method: paymentMethod || 'Cash',
                status: 'Success',
                date: new Date().toISOString()
            });
        }

        const registrationData = {
            lead_id: lead.id,
            student_id: studentId,
            name: fullName || lead.name,
            email: email || lead.email,
            phone: phone || lead.phone,
            course: course || lead.course || lead.university || lead.service_type || 'Unknown',
            intake: intake || 'Not Specified',
            status: 'Registered',
            payment_status: finalPaymentStatus,
            payment_details: { totalAmount: total, paidAmount: paid, balance: balance, installments: installments },
            workflow: {
                originCounsellor: req.user.id,
                currentOwner: 'COUNSELLOR',
                task1Status: false,
                admissionStatus: 'awaiting',
                loanOpted: loanOpted,
                passwordHash: passwordHash,
                dob: dob,
                preferredCountry: country,
                workflow: {
                    currentOwner: 'COUNSELLOR',
                    originCounsellor: req.user.id,
                    counsellor_task_status: 'IN_PROGRESS',
                    admissionStatus: 'awaiting',
                    loanOpted: loanOpted,
                    preferredCountry: country,
                    dob: dob
                }
            },
            activities: [{ user: req.user.name, action: 'Lead converted to registration and portal created', timestamp: new Date().toISOString() }]
        };

        const { data: registration, error: regError } = await supabase
            .from('registrations')
            .insert([registrationData])
            .select()
            .single();

        if (regError) throw regError;

        await supabase.from('leads').update({ status: 'CONVERTED' }).eq('id', lead.id);

        let pdfBuffer = null;
        try {
            pdfBuffer = await pdfService.generateRegistrationPDF({
                name: fullName || lead.name,
                email: targetEmail,
                phone: phone || lead.phone,
                studentId: studentId,
                course: course || lead.course || 'Not specified',
                country: country || 'Not specified',
                loanOpted: loanOpted,
                paymentStatus: finalPaymentStatus,
                totalAmount: total,
                paidAmount: paid,
                balance: balance,
                password: plainPassword,
                registrationDate: new Date().toLocaleDateString('en-IN')
            }, registration.id);
        } catch (pdfErr) {
            logger.error(`PDF Generation Failed: ${pdfErr.message}`);
        }

        try {
            await emailService.sendStudentRegistrationEmail(
                targetEmail,
                fullName,
                { username: targetEmail, password: plainPassword },
                pdfBuffer
            );
        } catch (emailErr) {
            logger.error(`❌ Registration email failed: ${emailErr.message}`);
        }

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_CONVERTED',
            metadata: { leadId: lead.id, registrationId: registration.id, studentId },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(registration);
    } catch (err) {
        logger.error(`registerStudent Error: ${err.message}`);
        res.status(500).json({ error: 'Registration Failed', details: err.message });
    }
};

// @route   POST api/crm/registrations/:id/close
exports.closeRegistration = async (req, res) => {
    try {
        const { outcome, reason } = req.body;

        const { data: reg, error: fetchError } = await supabase
            .from('registrations')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchError || !reg) return res.status(404).json({ msg: 'Registration not found' });

        const { data: updatedReg, error } = await supabase
            .from('registrations')
            .update({
                is_closed: true,
                final_outcome: outcome,
                closure_reason: reason,
                status: 'Closed',
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'REGISTRATION_CLOSED',
            metadata: { regId: req.params.id, outcome, reason },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`closeRegistration Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/registrations/my
exports.getMyRegistrations = async (req, res) => {
    try {
        const { data: registrations, error } = await supabase
            .from('registrations')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const filtered = req.user.role === 'super_admin'
            ? registrations
            : registrations.filter(r =>
                r.workflow?.currentOwner === 'COUNSELLOR' ||
                r.workflow?.originCounsellor === req.user.id
            );

        const flattened = filtered.map(r => ({
            ...r,
            fullName: r.name,
            full_name: r.name,
            loanOpted: r.workflow?.loanOpted,
            preferredCountry: r.workflow?.preferredCountry,
            dob: r.workflow?.dob,
            counsellorName: req.user.name
        }));

        res.json(flattened);
    } catch (err) {
        logger.error(`getMyRegistrations Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * DELETE api/crm/leads/:id
 * Soft deletes a lead (moves to trash)
 */
exports.softDeleteLead = async (req, res) => {
    try {
        const { data: lead, error } = await supabase
            .from('leads')
            .update({
                is_deleted: true,
                status: 'REJECTED',
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_SOFT_DELETED',
            metadata: { leadId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Lead moved to trash', lead });
    } catch (err) {
        logger.error(`softDeleteLead Error: ${err.message}`);
        res.status(500).json({ msg: 'Deletion failed', error: err.message });
    }
};

/**
 * @desc    Bulk soft-delete leads
 * @access  Admin
 */
exports.bulkDeleteLeads = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ msg: 'No IDs provided' });
        }

        const { data, error } = await supabase
            .from('leads')
            .update({
                is_deleted: true,
                status: 'REJECTED',
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .in('id', ids);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEADS_BULK_DELETED',
            metadata: { count: ids.length, ids },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: `${ids.length} leads moved to trash`, count: ids.length });
    } catch (err) {
        logger.error(`bulkDeleteLeads Error: ${err.message}`);
        res.status(500).json({ msg: 'Bulk deletion failed', error: err.message });
    }
};

/**
 * POST api/crm/leads/:id/restore
 * Restores a soft-deleted lead
 */
exports.restoreLead = async (req, res) => {
    try {
        const { data: lead, error } = await supabase
            .from('leads')
            .update({
                is_deleted: false,
                deleted_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_RESTORED',
            metadata: { leadId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Lead restored successfully', lead });
    } catch (err) {
        logger.error(`restoreLead Error: ${err.message}`);
        res.status(500).json({ msg: 'Restoration failed', error: err.message });
    }
};

// @route   GET api/crm/trash-leads
// @desc    Fetch rejected leads (admin only) with pagination and filtering
exports.getTrashLeads = async (req, res) => {
    try {
        const { id: employee_id, role, dept: employee_dept } = req.user || {};
        const isSuperAdmin = role?.toUpperCase() === 'SUPER_ADMIN';

        // Pagination
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;

        // Date filtering (Optional: defaults to all time if not provided)
        // Ensure full ISO format with time
        let dateFrom = req.query.dateFrom;
        let dateTo = req.query.dateTo;

        if (dateFrom && !dateFrom.includes('T')) dateFrom = `${dateFrom}T00:00:00.000Z`;
        if (dateTo && !dateTo.includes('T')) dateTo = `${dateTo}T23:59:59.999Z`;

        // Counsellor filter (for admin oversight)
        const { counsellorId, search } = req.query;

        // Enhanced logging for debugging
        logger.info(`[getTrashLeads] Request from user: ${employee_id}, role: ${role}, dept: ${employee_dept}`);
        logger.info(`[getTrashLeads] Query params:`, {
            page,
            limit,
            dateFrom,
            dateTo,
            counsellorId,
            search,
            isSuperAdmin,
            departmentId: req.user.departmentId || req.user.department_id
        });

        // Query rejected leads - join with employees to get assigned counsellor name
        let query = supabase
            .from('leads')
            .select(`
                *,
                assigned_employee:assigned_to (
                    name
                )
            `, { count: 'exact' })
            .or('status.eq.REJECTED,is_deleted.eq.true');

        // Apply Date Filters only if provided
        if (dateFrom) query = query.gte('updated_at', dateFrom);
        if (dateTo) query = query.lte('updated_at', dateTo);

        query = query.order('updated_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Department filtering (non-super admins)
        let appliedDeptFilter = null;
        if (!isSuperAdmin) {
            const deptId = req.user.departmentId || req.user.department_id;

            if (deptId) {
                logger.info(`[getTrashLeads] Applying department filter: ${deptId}`);
                query = query.eq('department_id', deptId);
                appliedDeptFilter = deptId;
            } else if (employee_dept) {
                // Fallback: Look up by code if ID missing (Legacy support)
                logger.info(`[getTrashLeads] Looking up department by code: ${employee_dept}`);
                const { data: deptData } = await supabase
                    .from('departments')
                    .select('id')
                    .eq('code', employee_dept.toUpperCase())
                    .maybeSingle();

                if (deptData) {
                    logger.info(`[getTrashLeads] Found department ID: ${deptData.id}`);
                    query = query.eq('department_id', deptData.id);
                    appliedDeptFilter = deptData.id;
                } else {
                    logger.warn(`[getTrashLeads] Department not found for code: ${employee_dept}, returning empty result`);
                    // Security Fallback: If dept unknown, show nothing
                    query = query.eq('id', '00000000-0000-0000-0000-000000000000');
                }
            } else {
                logger.warn(`[getTrashLeads] No department ID or code found for user ${employee_id}`);
            }
        } else {
            logger.info(`[getTrashLeads] Super admin - no department filter applied`);
        }

        // Counsellor filtering
        if (counsellorId) {
            query = query.eq('assigned_to', counsellorId);
        }

        // Search filtering
        if (search && search.trim()) {
            query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
        }

        const { data: rejectedLeads, error, count } = await query;

        if (error) {
            logger.error(`[getTrashLeads] Supabase Error:`, error);
            throw error;
        }

        // Null-safe count handling
        const totalCount = count || 0;

        logger.info(`[getTrashLeads] Query completed. Found ${totalCount} rejected leads (showing ${rejectedLeads?.length || 0} on this page)`);

        // Log sample of leads for debugging
        if (rejectedLeads && rejectedLeads.length > 0) {
            logger.info(`[getTrashLeads] Sample lead:`, {
                id: rejectedLeads[0].id,
                name: rejectedLeads[0].name,
                status: rejectedLeads[0].status,
                department_id: rejectedLeads[0].department_id,
                rejection_details: rejectedLeads[0].rejection_details
            });
        }

        // Format response with rejection details
        const formattedLeads = (rejectedLeads || []).map(lead => ({
            ...lead,
            rejection_reason: lead.rejection_details?.reason || 'No reason provided',
            rejected_by_id: lead.rejection_details?.rejectedBy,
            rejected_at: lead.rejection_details?.at || lead.updated_at,
            rejected_by_name: lead.assigned_employee?.name || 'Unassigned'
        }));

        res.json({
            leads: formattedLeads,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: totalCount > 0 ? Math.ceil(totalCount / limit) : 0,
                hasMore: (page * limit) < totalCount
            },
            filters: {
                dateFrom,
                dateTo,
                counsellorId: counsellorId || 'ALL',
                search: search || '',
                appliedDepartmentFilter: appliedDeptFilter
            },
            debug: {
                isSuperAdmin,
                userDept: employee_dept,
                userDeptId: req.user.departmentId || req.user.department_id
            }
        });
    } catch (err) {
        logger.error(`[getTrashLeads] Error: ${err.message}`, { stack: err.stack });
        res.status(500).json({
            msg: 'Failed to fetch rejected leads',
            error: err.message,
            stack: err.stack,
            debug: {
                user: req.user,
                query: req.query
            }
        });
    }
};

/**
 * @route   PATCH api/crm/registrations/:id/complete-task
 * @desc    Mark counselor task as complete and transfer to Admission
 * @access  Counsellor
 */
exports.completeCounsellorTask = async (req, res) => {
    try {
        const registrationId = req.params.id;

        // 1. Get required documents for Counselor stage
        // In a real system, this might come from documentConfig.js
        // For now, let's assume a static list or fetch it if possible.
        const requiredDocIds = ['passport', 'high_school_marksheet', 'intermediate_marksheet', 'graduation_marksheet'];

        // 2. Check document completeness
        const completeness = await workflowService.checkDocumentCompleteness(registrationId, requiredDocIds);

        if (!completeness.isComplete) {
            return res.status(400).json({
                msg: 'Cannot complete task: Required documents missing',
                missingDocs: completeness.missingDocs,
                progress: completeness.progress
            });
        }

        // 3. Perform transition via WorkflowService
        const updatedRegistration = await workflowService.transitionState(
            registrationId,
            'ADMISSION',
            {
                counsellor_task_status: 'COMPLETED',
                counsellor_completed_at: new Date().toISOString()
            },
            req.user
        );

        res.json({
            success: true,
            msg: 'Counselor task completed. Record transferred to Admission.',
            registration: updatedRegistration
        });
    } catch (err) {
        logger.error(`completeCounsellorTask Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   POST api/crm/trash-leads/:id/restore
// @desc    Restore a rejected lead (admin only)
exports.restoreRejectedLead = async (req, res) => {
    try {
        const { id } = req.params;
        const { reassignTo } = req.body; // Optional: reassign to different counsellor

        // Fetch current lead
        const { data: lead, error: fetchError } = await supabase
            .from('leads')
            .select('*')
            .eq('id', id)
            .eq('status', 'REJECTED')
            .single();

        if (fetchError || !lead) {
            return res.status(404).json({ msg: 'Rejected lead not found' });
        }

        // Restore lead
        const updateData = {
            status: 'CONTACTED',
            is_assigned: true,
            assigned_to: reassignTo || lead.assigned_to,
            updated_at: new Date().toISOString()
        };

        const { data: restoredLead, error: updateError } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Audit log
        await supabase.from('lead_audit_logs').insert({
            lead_id: id,
            action: 'RESTORE',
            performed_by: req.user.id,
            old_values: { status: 'REJECTED' },
            new_values: restoredLead
        });

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_RESTORED',
            metadata: {
                leadId: id,
                reassignedTo: reassignTo || lead.assigned_to,
                previousStatus: 'REJECTED'
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            msg: 'Lead restored successfully',
            lead: restoredLead
        });
    } catch (err) {
        logger.error(`restoreRejectedLead Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to restore lead', error: err.message });
    }
};

// @route   POST api/crm/trash-leads/:id/reassign
// @desc    Reassign a rejected lead to another counsellor (admin only)
exports.reassignRejectedLead = async (req, res) => {
    try {
        const { id } = req.params;
        const { newCounsellorId } = req.body;

        if (!newCounsellorId) {
            return res.status(400).json({ msg: 'New counsellor ID is required' });
        }

        // Verify new counsellor exists
        const { data: counsellor, error: counsellorError } = await supabase
            .from('employees')
            .select('id, name')
            .eq('id', newCounsellorId)
            .single();

        if (counsellorError || !counsellor) {
            return res.status(404).json({ msg: 'Counsellor not found' });
        }

        // Update lead
        const { data: reassignedLead, error: updateError } = await supabase
            .from('leads')
            .update({
                status: 'CONTACTED',
                is_assigned: true,
                assigned_to: newCounsellorId,
                assigned_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('status', 'REJECTED')
            .select()
            .single();

        if (updateError) throw updateError;

        if (!reassignedLead) {
            return res.status(404).json({ msg: 'Rejected lead not found' });
        }

        // Audit log
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LEAD_REASSIGNED_FROM_TRASH',
            metadata: {
                leadId: id,
                newCounsellorId,
                newCounsellorName: counsellor.name
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            msg: 'Lead reassigned successfully',
            lead: reassignedLead,
            assignedTo: counsellor
        });
    } catch (err) {
        logger.error(`reassignRejectedLead Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to reassign lead', error: err.message });
    }
};

/**
 * @route   PATCH api/crm/registrations/:id/complete-task
 * @desc    Mark counselor task as complete and transfer to Admission
 * @access  Counsellor
 */
exports.completeCounsellorTask = async (req, res) => {
    try {
        const registrationId = req.params.id;

        // 1. Get required documents for Counselor stage
        // In a real system, this might come from documentConfig.js
        const requiredDocIds = ['passport', 'high_school_marksheet', 'intermediate_marksheet', 'graduation_marksheet'];

        // 2. Check document completeness
        const completeness = await workflowService.checkDocumentCompleteness(registrationId, requiredDocIds);

        if (!completeness.isComplete) {
            return res.status(400).json({
                msg: 'Cannot complete task: Required documents missing',
                missingDocs: completeness.missingDocs,
                progress: completeness.progress
            });
        }

        // 3. Perform transition via WorkflowService
        const updatedRegistration = await workflowService.transitionState(
            registrationId,
            'ADMISSION',
            {
                counsellor_task_status: 'COMPLETED',
                counsellor_completed_at: new Date().toISOString()
            },
            req.user
        );

        res.json({
            success: true,
            msg: 'Counselor task completed. Record transferred to Admission.',
            registration: updatedRegistration
        });
    } catch (err) {
        logger.error(`completeCounsellorTask Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};
