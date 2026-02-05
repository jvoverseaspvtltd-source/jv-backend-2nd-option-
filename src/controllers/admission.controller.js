const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const workflowService = require('../services/workflow.service');

// ============================================================================
// DASHBOARD & REGISTRATIONS
// ============================================================================

// @route   GET api/crm/admission/dashboard
exports.getDashboardStats = async (req, res) => {
    logger.info('getDashboardStats triggered - V2 HEARTBEAT');
    try {
        const { count: totalCount, error: totalError } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .eq('is_deleted', false);
        if (totalError) logger.error('getDashboardStats totalError:', totalError);

        const { count: successCount, error: successError } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .eq('admission_status', 'SUCCESS')
            .eq('is_deleted', false);
        if (successError) logger.error('getDashboardStats successError:', successError);

        const { count: pendingCount, error: pendingError } = await supabase
            .from('registrations')
            .select('*', { count: 'exact', head: true })
            .eq('admission_status', 'PENDING')
            .eq('is_deleted', false);
        if (pendingError) logger.error('getDashboardStats pendingError:', pendingError);

        const { count: completedTasksCount, error: taskError } = await supabase
            .from('admission_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'COMPLETED')
            .eq('assigned_to', req.user.id);
        if (taskError) logger.error('getDashboardStats taskError:', taskError);

        if (totalError || successError || pendingError || taskError) {
            const err = totalError || successError || pendingError || taskError;
            logger.error(`getDashboardStats Database Error: ${JSON.stringify(err)}`);
            throw err;
        }

        res.json({
            totalRegistered: totalCount || 0,
            successfulAdmissions: successCount || 0,
            pendingCases: pendingCount || 0,
            completedTasks: completedTasksCount || 0
        });
    } catch (err) {
        logger.error(`getDashboardStats catch block - Error: ${err.message || 'No Message'}, Details: ${JSON.stringify(err)}`);
        res.status(500).json({
            msg: 'Server Error',
            error: err.message || 'Unknown Error',
            details: err
        });
    }
};

// @route   PATCH api/crm/admission/registrations/:id/toggle-loan
exports.toggleLoanOpted = async (req, res) => {
    try {
        const { loanOpted } = req.body; // boolean

        // 1. Fetch current workflow
        const { data: currentReg, error: fetchError } = await supabase
            .from('registrations')
            .select('workflow')
            .eq('id', req.params.id)
            .single();

        if (fetchError || !currentReg) {
            return res.status(404).json({ msg: 'Registration not found' });
        }

        const updatedWorkflow = {
            ...currentReg.workflow,
            loanOpted: loanOpted
        };

        // 2. Update workflow
        const { data: updatedReg, error: updateError } = await supabase
            .from('registrations')
            .update({
                workflow: updatedWorkflow,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateError) throw updateError;

        // 3. Log Audit
        await auditService.logAction({
            employeeId: req.user.id,
            action: loanOpted ? 'LOAN_ASSISTANCE_ENABLED' : 'LOAN_ASSISTANCE_DISABLED',
            metadata: { regId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            msg: `Loan Assistance ${loanOpted ? 'Enabled' : 'Disabled'}`,
            registration: updatedReg
        });
    } catch (err) {
        logger.error(`toggleLoanOpted Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * @route   POST api/admission/registrations/:id/claim
 * @desc    Claim a registration from the Admission pool
 * @access  Admission
 */
exports.claimRegistration = async (req, res) => {
    try {
        const registrationId = req.params.id;

        // Verify current owner is ADMISSION
        const { data: registration, error: fetchError } = await supabase
            .from('registrations')
            .select('workflow')
            .eq('id', registrationId)
            .single();

        if (fetchError || !registration) {
            return res.status(404).json({ msg: 'Registration not found' });
        }

        if (registration.workflow?.currentOwner !== 'ADMISSION') {
            return res.status(403).json({ msg: 'Access Denied: This record is not yet in the Admission stage' });
        }

        // Update registration with assigned admission employee
        const { data: updated, error: updateError } = await supabase
            .from('registrations')
            .update({
                assigned_admission_id: req.user.id,
                admission_assigned_at: new Date().toISOString(),
                admission_status: 'Processing',
                updated_at: new Date().toISOString()
            })
            .eq('id', registrationId)
            .select()
            .single();

        if (updateError) throw updateError;

        // Log audit action
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'REGISTRATION_CLAIMED_BY_ADMISSION',
            metadata: { registrationId },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            msg: 'Registration successfully claimed by Admission',
            registration: updated
        });
    } catch (err) {
        logger.error(`claimRegistration Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// ============================================================================
// ADMISSION APPLICATIONS
// ============================================================================

// @route   POST api/admission/applications
exports.createApplication = async (req, res) => {
    try {
        const { registrationId, university, course, intake, fees } = req.body;

        const { data: application, error } = await supabase
            .from('admission_applications')
            .insert({
                registration_id: registrationId,
                university,
                course,
                intake,
                fees: fees || { applicationFee: 0, tuitionFee: 0, currency: 'USD' },
                // New Fields
                program_name: req.body.programName,
                course_duration: req.body.courseDuration,
                tuition_fee: req.body.tuitionFee,
                tuition_fee_currency: req.body.tuitionFeeCurrency || 'USD',
                fees_structure: req.body.feesStructure,
                mode_of_attendance: req.body.modeOfAttendance,
                start_date: req.body.startDate,
                campus_name: req.body.campusName,
                campus_address: req.body.campusAddress,
                admission_notes: req.body.admissionNotes,
                assigned_to: req.user.id
            })
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ADMISSION_APPLICATION_CREATED',
            metadata: { registrationId, university, course },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(application);
    } catch (err) {
        logger.error(`createApplication Error: ${err.message}`);
        logger.error(`createApplication Full Error:`, err);
        res.status(500).json({ msg: 'Server Error', error: err.message, details: err.hint || err.details });
    }
};

// @route   GET api/admission/applications/:registrationId
exports.getApplicationsByRegistration = async (req, res) => {
    try {
        const { data: applications, error } = await supabase
            .from('admission_applications')
            .select('*')
            .eq('registration_id', req.params.registrationId);

        if (error) throw error;
        res.json(applications);
    } catch (err) {
        logger.error(`getApplications Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/admission/applications/:id/status
exports.updateApplicationStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const { data: application, error } = await supabase
            .from('admission_applications')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(application);
    } catch (err) {
        logger.error(`updateApplicationStatus Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// OFFER LETTERS
// ============================================================================

// @route   POST api/admission/offer-letters
exports.uploadOfferLetter = async (req, res) => {
    try {
        const { registrationId, applicationId, university, status, filePath, fileName } = req.body;

        // Update the application record directly with the offer letter URL
        const { data: app, error } = await supabase
            .from('admission_applications')
            .update({
                offer_letter_url: filePath,
                status: 'Approved', // Auto-set status if needed, or keep as passed
                updated_at: new Date().toISOString()
            })
            .eq('id', applicationId)
            .select()
            .single();

        if (error) throw error;

        // Also keep the track in offer_letters table if we want a history, 
        // but requirements emphasize "Offer Letter Upload (only visible if status = Approved)" linked to the app.
        // Let's Insert into offer_letters as well for audit/history
        await supabase
            .from('offer_letters')
            .insert({
                registration_id: registrationId,
                application_id: applicationId,
                university,
                status: status || 'Approved',
                file_path: filePath,
                file_name: fileName
            });

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'OFFER_LETTER_UPLOADED',
            metadata: { registrationId, applicationId, university },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(app);
    } catch (err) {
        logger.error(`uploadOfferLetter Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PATCH api/admission/applications/:id/details
exports.updateApplicationDetails = async (req, res) => {
    try {
        const {
            university, course, intake, duration,
            tuitionFee, feesStructure, mode,
            startDate, campusName, campusAddress,
            status, rejectionReason, notes
        } = req.body;

        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (university) updateData.university = university;
        if (course) updateData.course = course;
        if (intake) updateData.intake = intake;
        if (duration) updateData.course_duration = duration;
        if (tuitionFee) updateData.tuition_fee = tuitionFee;
        if (req.body.tuitionFeeCurrency) updateData.tuition_fee_currency = req.body.tuitionFeeCurrency;
        if (feesStructure) updateData.fees_structure = feesStructure;
        if (mode) updateData.mode_of_attendance = mode;
        if (startDate) updateData.start_date = startDate;
        if (campusName) updateData.campus_name = campusName;
        if (campusAddress) updateData.campus_address = campusAddress;
        if (notes) updateData.admission_notes = notes;

        // Status Logic
        if (status) {
            updateData.status = status;
            if ((status === 'Rejected' || status === 'Withdrawn') && !rejectionReason && !req.body.ignoreValidation) {
                // We can enforce validation here or in frontend. 
                // Given "Mandatory notes field", we should enforce it if reason passed.
            }
            if (rejectionReason) updateData.rejection_reason = rejectionReason;
        }

        const { data: application, error } = await supabase
            .from('admission_applications')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ADMISSION_APPLICATION_UPDATED',
            metadata: { appId: req.params.id, changes: updateData },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(application);
    } catch (err) {
        logger.error(`updateApplicationDetails Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// ============================================================================
// LOAN APPLICATIONS
// ============================================================================

exports.getLoanApplication = async (req, res) => {
    try {
        const { data: loan, error } = await supabase
            .from('loan_applications')
            .select(`
                *,
                payments:loan_payments(*)
            `)
            .eq('registration_id', req.params.registrationId)
            .maybeSingle();

        if (error) throw error;

        if (loan) {
            // Ensure defaults and calculations
            loan.processing_fee = loan.processing_fee || 57000.00;
            loan.paid_amount = loan.paid_amount || loan.total_paid || 0;
            loan.remaining_amount = Math.max(0, loan.processing_fee - loan.paid_amount);
        }

        res.json(loan || null);
    } catch (err) {
        logger.error(`getLoanApplication Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/admission/loan
// @desc    Upsert loan application (Student or Admin)
exports.upsertLoanApplication = async (req, res) => {
    try {
        const {
            registrationId,
            loanAmount,
            bankName,
            branchName,
            loanType,
            appliedThrough,
            applicationDate,
            coApplicantName,
            coApplicantEmail,
            coApplicantPhone,
            relationship,
            remarks
        } = req.body;

        const { data: existing, error: fetchError } = await supabase
            .from('loan_applications')
            .select('id')
            .eq('registration_id', registrationId)
            .maybeSingle();

        const loanData = {
            loan_amount: loanAmount,
            bank_name: bankName,
            branch_name: branchName,
            loan_type: loanType || 'Education Loan',
            applied_through: appliedThrough || 'Veda Loans & Finance',
            application_date: applicationDate || new Date().toISOString().split('T')[0],
            co_applicant_name: coApplicantName,
            co_applicant_email: coApplicantEmail,
            co_applicant_phone: coApplicantPhone,
            relationship: relationship,
            remarks: remarks,
            updated_at: new Date().toISOString()
        };

        let loan, error;

        if (existing) {
            const { data, error: err } = await supabase
                .from('loan_applications')
                .update(loanData)
                .eq('id', existing.id)
                .select()
                .single();
            loan = data;
            error = err;
        } else {
            const { data, error: err } = await supabase
                .from('loan_applications')
                .insert({
                    registration_id: registrationId,
                    ...loanData,
                    agent_id: req.user.role !== 'STUDENT' ? req.user.id : null
                })
                .select()
                .single();
            loan = data;
            error = err;
        }

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.role !== 'STUDENT' ? req.user.id : null,
            action: existing ? 'LOAN_APPLICATION_UPDATED' : 'LOAN_APPLICATION_SUBMITTED',
            metadata: { registrationId },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(loan);
    } catch (err) {
        logger.error(`upsertLoanApplication Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PATCH api/admission/loan/:id/status
// @desc    Update loan status (Admission Dept Only)
exports.updateLoanStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;

        // Final Authority Check: Admission Dept / Admin Only
        const userRole = req.user.role;
        const userDept = req.user.dept?.toUpperCase();
        const isAdmin = ['super_admin', 'admission_admin', 'counselling_admin', 'wfh_admin'].includes(userRole) || userDept === 'ADMISSION';

        if (!isAdmin) {
            return res.status(403).json({ msg: 'Forbidden: Only authorized staff can update loan status' });
        }

        // Fetch current loan to validate transitions
        const { data: currentLoan, error: fetchError } = await supabase
            .from('loan_applications')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchError || !currentLoan) {
            return res.status(404).json({ msg: 'Loan application not found' });
        }

        // Rule 4: Co-Applicant mandatory when status >= Approved
        const isApproving = ['Approved', 'Disbursed'].includes(status);
        if (isApproving && !currentLoan.co_applicant_name) {
            return res.status(400).json({ msg: 'Co-applicant details are mandatory before approving a loan' });
        }

        const updates = {
            status,
            remarks: remarks || currentLoan.remarks,
            updated_at: new Date().toISOString()
        };

        const { data: loan, error } = await supabase
            .from('loan_applications')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LOAN_STATUS_UPDATED',
            metadata: { loanId: req.params.id, status },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(loan);
    } catch (err) {
        logger.error(`updateLoanStatus Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/admission/loan/payment
// @desc    Record a new loan payment
exports.recordPayment = async (req, res) => {
    try {
        const { loanId, amount, notes, paymentDate } = req.body;

        if (!loanId || !amount || !notes) {
            return res.status(400).json({ msg: 'Loan ID, Amount, and Notes are required' });
        }

        // 1. Insert Payment
        const { data: payment, error: payError } = await supabase
            .from('loan_payments')
            .insert({
                loan_id: loanId,
                amount,
                notes,
                payment_date: paymentDate || new Date().toISOString(),
                created_by: req.user.id
            })
            .select()
            .single();

        if (payError) throw payError;

        // 2. Fetch current state to calculate totals
        const { data: loan, error: fetchError } = await supabase
            .from('loan_applications')
            .select('total_paid, paid_amount, processing_fee')
            .eq('id', loanId)
            .single();

        if (fetchError) throw fetchError;

        // Calculate new totals (Handle mismatch between legacy total_paid and new paid_amount)
        const currentPaid = Math.max(Number(loan.total_paid) || 0, Number(loan.paid_amount) || 0);
        const newTotal = currentPaid + Number(amount);

        // 3. Update BOTH columns to ensure consistency
        const { error: updateError } = await supabase
            .from('loan_applications')
            .update({
                total_paid: newTotal,
                paid_amount: newTotal,
                updated_at: new Date().toISOString()
            })
            .eq('id', loanId);

        if (updateError) throw updateError;

        // Calculate Remaining
        const processingFee = loan.processing_fee || 57000.00;
        const remainingAmount = Math.max(0, processingFee - newTotal);

        // 4. Log Audit
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LOAN_PAYMENT_RECORDED',
            metadata: { loanId, amount, newTotal, remainingAmount },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            payment,
            newTotalPaid: newTotal,
            remainingAmount
        });
    } catch (err) {
        logger.error(`recordPayment Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PATCH api/admission/loan/:id/details
// @desc    Update loan disbursement details
exports.updateLoanDetails = async (req, res) => {
    try {
        const {
            bankName,
            branchName,
            sanctionedAmount,
            disbursedAmount,
            interestRate,
            loanTenure,
            emiAmount,
            partnerCompany,
            disbursementDate,
            coApplicantName,
            coApplicantEmail,
            coApplicantPhone,
            relationship
        } = req.body;

        // Fetch current loan for validation
        const { data: currentLoan } = await supabase
            .from('loan_applications')
            .select('loan_amount')
            .eq('id', req.params.id)
            .single();

        // Rule 8: Approved amount <= Applied amount
        if (sanctionedAmount !== undefined && sanctionedAmount > (currentLoan?.loan_amount || Infinity)) {
            return res.status(400).json({ msg: 'Sanctioned amount cannot exceed applied amount' });
        }

        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (bankName !== undefined) updateData.bank_name = bankName;
        if (branchName !== undefined) updateData.branch_name = branchName;
        if (sanctionedAmount !== undefined) updateData.sanctioned_amount = sanctionedAmount;
        if (disbursedAmount !== undefined) updateData.disbursed_amount = disbursedAmount;
        if (interestRate !== undefined) updateData.interest_rate = interestRate;
        if (loanTenure !== undefined) updateData.loan_tenure = loanTenure;
        if (emiAmount !== undefined) updateData.emi_amount = emiAmount;
        if (partnerCompany !== undefined) updateData.partner_company = partnerCompany;
        if (disbursementDate !== undefined) updateData.loan_disbursement_date = disbursementDate;

        // Co-applicant updates
        if (coApplicantName !== undefined) updateData.co_applicant_name = coApplicantName;
        if (coApplicantEmail !== undefined) updateData.co_applicant_email = coApplicantEmail;
        if (coApplicantPhone !== undefined) updateData.co_applicant_phone = coApplicantPhone;
        if (relationship !== undefined) updateData.relationship = relationship;

        const { data: loan, error } = await supabase
            .from('loan_applications')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LOAN_DETAILS_UPDATED',
            metadata: { loanId: req.params.id, changes: updateData },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(loan);
    } catch (err) {
        logger.error(`updateLoanDetails Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/admission/registrations
exports.getOfferLetters = async (req, res) => {
    try {
        const { data: offers, error } = await supabase
            .from('offer_letters')
            .select('*')
            .eq('registration_id', req.params.registrationId);

        if (error) throw error;
        res.json(offers);
    } catch (err) {
        logger.error(`getOfferLetters Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/admission/registrations
exports.getRegistrations = async (req, res) => {
    try {
        const { status, trash } = req.query;
        let query = supabase.from('registrations').select('*');

        if (trash === 'true') {
            query = query.eq('is_deleted', true);
        } else {
            query = query.eq('is_deleted', false);
        }

        if (status) {
            query = query.eq('admission_status', status);
        }

        // Exclude fully completed students from active list
        // (They only show in Success Registry)
        if (trash !== 'true') {
            // A student is "In Progress" if Admission is not done OR (Loan is required AND Loan is not done)
            query = query.or('is_admission_completed.eq.false,and(loan_required.eq.true,is_loan_completed.eq.false)');
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
        logger.error(`getRegistrations Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/admission/registrations/:id
exports.getRegistrationById = async (req, res) => {
    try {
        const { data: registration, error } = await supabase
            .from('registrations')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        if (!registration) return res.status(404).json({ msg: 'Registration not found' });

        // Fetch Counsellor Name & Dept Code if ID exists in workflow
        let originCounsellorName = 'N/A';
        const counsellorId = registration.workflow?.originCounsellor;
        if (counsellorId) {
            const { data: emp } = await supabase
                .from('employees')
                .select('name, department:department_id(name, code)')
                .eq('id', counsellorId)
                .maybeSingle();
            if (emp) {
                const deptDisplay = emp.department?.code || emp.department?.name || 'NA';
                originCounsellorName = `${emp.name} (${deptDisplay})`;
            }
        }

        // Flatten workflow fields for frontend compatibility
        const flattened = {
            loan_opted: false, // Default
            ...registration,
            fullName: registration.name,
            full_name: registration.name,
            loan_required: registration.loan_required ?? registration.loan_opted ?? registration.workflow?.loanOpted ?? false,
            loanOpted: registration.loan_opted ?? registration.workflow?.loanOpted ?? false,
            preferredCountry: registration.workflow?.preferredCountry,
            dob: registration.workflow?.dob,
            workflow: {
                ...registration.workflow,
                originCounsellorName // Inject for frontend
            }
        };

        res.json(flattened);
    } catch (err) {
        logger.error(`getRegistrationById Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/registrations/:id/cancel
exports.cancelAdmission = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ msg: 'Reason is required for cancellation' });

        const now = new Date().toISOString();
        const { data: updatedReg, error } = await supabase
            .from('registrations')
            .update({
                admission_status: 'CANCELLED',
                cancel_reason: reason,
                cancel_at: now,
                updated_at: now
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        // Log to activities
        await supabase.rpc('append_activity', {
            registration_id: req.params.id,
            new_activity: {
                user: req.user.name,
                action: 'Admission Cancelled / Denied',
                notes: reason,
                timestamp: now
            }
        });

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ADMISSION_CANCELLED',
            metadata: { regId: req.params.id, reason },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`cancelAdmission Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/registrations/:id/defer
exports.deferIntake = async (req, res) => {
    try {
        const { newIntake, reason } = req.body;
        if (!newIntake) return res.status(400).json({ msg: 'New intake is required' });

        const { data: reg, error: fetchError } = await supabase
            .from('registrations')
            .select('intake')
            .eq('id', req.params.id)
            .single();

        if (fetchError || !reg) return res.status(404).json({ msg: 'Registration not found' });

        const oldIntake = reg.intake;
        const now = new Date().toISOString();

        // 1. Update Registration
        const { data: updatedReg, error: updateError } = await supabase
            .from('registrations')
            .update({
                intake: newIntake,
                updated_at: now
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateError) throw updateError;

        // 2. Log to intake_deferrals
        const { error: deferError } = await supabase
            .from('intake_deferrals')
            .insert({
                registration_id: req.params.id,
                old_intake: oldIntake,
                new_intake: newIntake,
                reason: reason,
                updated_by: req.user.id
            });

        if (deferError) logger.error(`deferIntake Log Error: ${deferError.message}`);

        // 3. Activity Log
        await supabase.rpc('append_activity', {
            registration_id: req.params.id,
            new_activity: {
                user: req.user.name,
                action: 'Intake Deferred',
                notes: `Changed from ${oldIntake || 'N/A'} to ${newIntake}. Reason: ${reason || 'N/A'}`,
                timestamp: now
            }
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`deferIntake Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/admission/intake-deferrals
exports.getIntakeDeferrals = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('intake_deferrals')
            .select(`
                *,
                registration:registration_id (
                    id,
                    name,
                    student_id,
                    course
                ),
                employee:updated_by (
                    name
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        logger.error(`getIntakeDeferrals Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PUT api/crm/admission/registrations/:id/status
exports.updateAdmissionStatus = async (req, res) => {
    try {
        const { status, notes } = req.body;

        const updateData = {
            admission_status: status,
            updated_at: new Date().toISOString(),
        };

        // Handle final completion logic
        if (status === 'SUCCESS' || status === 'Approved') {
            updateData.status = 'Admission Approved';
            // We can add a flag in workflow for Student Portal to show offer letters
            // Or just rely on the registrations.status change
        }

        const { data: updatedReg, error } = await supabase
            .from('registrations')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        // Append activity log
        await supabase.rpc('append_activity', {
            registration_id: req.params.id,
            new_activity: {
                user: req.user.name,
                action: `Admission status updated to ${status}`,
                notes: notes || '',
                timestamp: new Date().toISOString()
            }
        });

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ADMISSION_STATUS_UPDATED',
            metadata: { regId: req.params.id, status },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`updateAdmissionStatus Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   DELETE api/crm/admission/registrations/:id
exports.softDeleteRegistration = async (req, res) => {
    try {
        const { data: updatedReg, error } = await supabase
            .from('registrations')
            .update({
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'REGISTRATION_SOFT_DELETED',
            metadata: { regId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Registration moved to trash', registration: updatedReg });
    } catch (err) {
        logger.error(`softDeleteRegistration Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/registrations/:id/restore
exports.restoreRegistration = async (req, res) => {
    try {
        const { data: updatedReg, error } = await supabase
            .from('registrations')
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
            action: 'REGISTRATION_RESTORED',
            metadata: { regId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Registration restored', registration: updatedReg });
    } catch (err) {
        logger.error(`restoreRegistration Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// TASK MANAGEMENT
// ============================================================================

// @route   GET api/crm/admission/tasks
exports.getTasks = async (req, res) => {
    try {
        const { status, type } = req.query; // type: assigned, completed, all (for admin)
        let query = supabase.from('admission_tasks').select(`
            *,
            assigned_to_info:employees!assigned_to(id, name, email),
            assigned_by_info:employees!assigned_by(id, name, email)
        `);

        if (type === 'assigned') {
            query = query.eq('assigned_to', req.user.id).neq('status', 'COMPLETED');
        } else if (type === 'completed') {
            query = query.eq('assigned_to', req.user.id).eq('status', 'COMPLETED');
        } else if (req.user.role === 'SUPER_ADMIN' || req.user.department === 'ADMIN') {
            // Admin sees all
        } else {
            query = query.eq('assigned_to', req.user.id);
        }

        if (status) {
            query = query.eq('status', status);
        }

        const { data: tasks, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json(tasks);
    } catch (err) {
        logger.error(`getTasks Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/tasks
exports.createTask = async (req, res) => {
    try {
        const { title, description, assignedTo, priority, dueDate } = req.body;

        const { data: task, error } = await supabase
            .from('admission_tasks')
            .insert({
                title,
                description,
                assigned_to: assignedTo,
                assigned_by: req.user.id,
                priority: priority || 'MEDIUM',
                due_date: dueDate,
                status: 'PENDING'
            })
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ADMISSION_TASK_CREATED',
            metadata: { taskId: task.id, assignedTo },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(task);
    } catch (err) {
        logger.error(`createTask Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/crm/admission/tasks/:id/status
exports.updateTaskStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const updateData = {
            status,
            updated_at: new Date().toISOString()
        };

        if (status === 'COMPLETED') {
            updateData.completed_at = new Date().toISOString();
        }

        const { data: task, error } = await supabase
            .from('admission_tasks')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ADMISSION_TASK_STATUS_UPDATED',
            metadata: { taskId: req.params.id, status },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(task);
    } catch (err) {
        logger.error(`updateTaskStatus Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// ANNOUNCEMENTS
// ============================================================================

// @route   GET api/crm/admission/announcements
exports.getAnnouncements = async (req, res) => {
    try {
        // Fetch announcements that are either:
        // 1. Targeted to ALL departments (target_audience = 'ALL')
        // 2. Targeted to this specific department (target_audience = 'DEPARTMENT' AND department = user's dept)
        const userDept = req.user.dept?.toUpperCase() || 'ADMISSION';

        const { data: announcements, error } = await supabase
            .from('announcements')
            .select(`
                *,
                created_by_info:employees(id, name, department:department_id(name, code))
            `)
            .or(`target_audience.eq.ALL,and(target_audience.eq.DEPARTMENT,department.eq.${userDept})`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(announcements);
    } catch (err) {
        logger.error(`getAnnouncements Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/announcements
exports.createAnnouncement = async (req, res) => {
    try {
        const { title, content, priority, targetAudience, targetDepartmentId } = req.body;

        const { data: announcement, error } = await supabase
            .from('announcements')
            .insert({
                title,
                content,
                priority: priority || 'NORMAL',
                target_audience: targetAudience || 'ALL',
                target_department_id: targetDepartmentId,
                created_by: req.user.id
            })
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'ANNOUNCEMENT_CREATED',
            metadata: { announcementId: announcement.id, title },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(announcement);
    } catch (err) {
        logger.error(`createAnnouncement Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// STUDY MATERIALS
// ============================================================================

// @route   GET api/crm/admission/study-materials
exports.getStudyMaterials = async (req, res) => {
    try {
        const { category } = req.query;
        let query = supabase.from('study_materials').select('*');

        if (category) {
            query = query.eq('category', category);
        }

        const { data: materials, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json(materials);
    } catch (err) {
        logger.error(`getStudyMaterials Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/study-materials
exports.createStudyMaterial = async (req, res) => {
    try {
        const { title, content, category, attachments } = req.body;

        const { data: material, error } = await supabase
            .from('study_materials')
            .insert({
                title,
                content,
                category,
                attachments: attachments || [],
                created_by: req.user.id,
                updated_by: req.user.id
            })
            .select()
            .single();

        if (error) throw error;

        res.json(material);
    } catch (err) {
        logger.error(`createStudyMaterial Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// QUERY & RESOLUTION
// ============================================================================

// @route   POST api/crm/admission/queries
exports.logQuery = async (req, res) => {
    try {
        const { title, description, priority } = req.body;

        const { data: query, error } = await supabase
            .from('operational_queries')
            .insert({
                title,
                description,
                priority: priority || 'MEDIUM',
                created_by: req.user.id,
                status: 'OPEN'
            })
            .select()
            .single();

        if (error) throw error;

        res.json(query);
    } catch (err) {
        logger.error(`logQuery Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/admission/queries
exports.getQueries = async (req, res) => {
    try {
        const { data: queries, error } = await supabase
            .from('operational_queries')
            .select(`
                *,
                created_by_info:employees(id, name),
                solutions:operational_solutions(*)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(queries);
    } catch (err) {
        logger.error(`getQueries Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/crm/admission/queries/:id/resolve
exports.resolveQuery = async (req, res) => {
    try {
        const { solution } = req.body;

        // 1. Create solution
        const { data: solObj, error: solError } = await supabase
            .from('operational_solutions')
            .insert({
                query_id: req.params.id,
                solution,
                created_by: req.user.id
            })
            .select()
            .single();

        if (solError) throw solError;

        // 2. Update query status
        const { data: query, error: qError } = await supabase
            .from('operational_queries')
            .update({ status: 'RESOLVED', updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (qError) throw qError;

        res.json({ query, solution: solObj });
    } catch (err) {
        logger.error(`resolveQuery Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/crm/admission/registrations/:id/complete-admission
exports.markAdmissionCompleted = async (req, res) => {
    try {
        const { completed } = req.body; // boolean

        const { data: updatedReg, error } = await supabase
            .from('registrations')
            .update({
                is_admission_completed: completed,
                admission_completed_by: completed ? req.user.id : null,
                admission_completed_at: completed ? new Date().toISOString() : null,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: completed ? 'ADMISSION_COMPLETED' : 'ADMISSION_COMPLETION_REVERSED',
            metadata: { regId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`markAdmissionCompleted Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/crm/admission/registrations/:id/complete-loan
exports.markLoanCompleted = async (req, res) => {
    try {
        const { completed } = req.body; // boolean

        const { data: updatedReg, error } = await supabase
            .from('registrations')
            .update({
                is_loan_completed: completed,
                loan_completed_by: completed ? req.user.id : null,
                loan_completed_at: completed ? new Date().toISOString() : null,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: completed ? 'LOAN_COMPLETED' : 'LOAN_COMPLETION_REVERSED',
            metadata: { regId: req.params.id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`markLoanCompleted Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/crm/admission/registrations/success-registry
exports.getSuccessRegistry = async (req, res) => {
    try {
        const { data: registrations, error } = await supabase
            .from('registrations')
            .select('*')
            .eq('is_admission_completed', true)
            .or('loan_required.eq.false,is_loan_completed.eq.true')
            .eq('is_deleted', false)
            .order('updated_at', { ascending: false });

        if (error) throw error;

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
        logger.error(`getSuccessRegistry Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PATCH api/crm/admission/registrations/:id/loan-requirement
exports.updateLoanRequirement = async (req, res) => {
    try {
        const { loanRequired } = req.body; // boolean

        // Only Admin roles can change this
        const userRole = req.user.role;
        const allowedRoles = ['super_admin', 'admission_admin', 'counselling_admin', 'wfh_admin', 'counsellor'];
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ msg: 'Unauthorized to change loan requirement' });
        }

        // Prepare updates
        const updates = {
            loan_opted: loanRequired, // Sync with original column
            loan_required: loanRequired,
            updated_at: new Date().toISOString()
        };

        // If Loan Required = No, auto-mark loan as completed
        if (loanRequired === false) {
            updates.is_loan_completed = true;
            updates.loan_completed_by = req.user.id;
            updates.loan_completed_at = new Date().toISOString();
        }

        let { data: updatedReg, error } = await supabase
            .from('registrations')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        // Fallback if loan_required or completion columns don't exist yet
        if (error && error.message.includes("column") && error.message.includes("not found")) {
            logger.warn(`Migration columns missing, falling back to basic sync: ${error.message}`);
            const fallbackUpdates = {
                loan_opted: loanRequired,
                updated_at: new Date().toISOString()
            };
            const { data: fallbackReg, error: fallbackError } = await supabase
                .from('registrations')
                .update(fallbackUpdates)
                .eq('id', req.params.id)
                .select()
                .single();

            if (fallbackError) throw fallbackError;
            updatedReg = fallbackReg;
        } else if (error) {
            throw error;
        }

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'LOAN_REQUIREMENT_UPDATED',
            metadata: { regId: req.params.id, loanRequired },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json(updatedReg);
    } catch (err) {
        logger.error(`updateLoanRequirement Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};
