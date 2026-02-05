const { uploadToSupabase, deleteFromSupabase, generateSignedUrl } = require('../middleware/storage.middleware');
const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const emailService = require('../services/email.service');

// @route   POST api/documents/upload
// @desc    Upload a student document
// @access  Authenticated (Student or Employee)
exports.uploadDocument = async (req, res) => {
    try {
        const { registrationId, docId } = req.body;
        const file = req.file;

        if (!registrationId || !docId || !file) {
            return res.status(400).json({ msg: 'Please provide registrationId, docId and a file' });
        }

        // Upload to Supabase Storage in 'study-materials' bucket
        const uploadResult = await uploadToSupabase(file, 'study-materials');

        // Check if document exists first to avoid ON CONFLICT error (missing unique constraint)
        const { data: existingDoc, error: checkError } = await supabase
            .from('student_documents')
            .select('id')
            .eq('registration_id', registrationId)
            .eq('doc_id', docId)
            .maybeSingle(); // Use maybeSingle to avoid 406 error if multiple found (though unlikely), or just to handle 0 results cleanly

        if (checkError) {
            logger.error(`[DATABASE_ERROR] Check existing doc failed: ${checkError.message}`);
            throw checkError;
        }

        let document;
        let dbError;

        if (existingDoc) {
            // Update existing
            const { data: updated, error: updateError } = await supabase
                .from('student_documents')
                .update({
                    file_path: uploadResult.path,
                    file_name: uploadResult.fileName,
                    status: 'UPLOADED', // Reset status on re-upload
                    remarks: null,      // Clear rejection remarks
                    uploaded_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingDoc.id)
                .select()
                .single();

            document = updated;
            dbError = updateError;
        } else {
            // Insert new
            const { data: inserted, error: insertError } = await supabase
                .from('student_documents')
                .insert({
                    registration_id: registrationId,
                    doc_id: docId,
                    file_path: uploadResult.path,
                    file_name: uploadResult.fileName,
                    status: 'UPLOADED',
                    uploaded_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            document = inserted;
            dbError = insertError;
        }

        if (dbError) {
            // Check for RLS policy violation
            if (dbError.code === '42501' || dbError.message.includes('new row violates row-level security policy')) {
                logger.error(`[RLS_VIOLATION] The database rejected the insert. Row-Level Security is enabled but no policy allows this insert.`);
                logger.error(`Hint: Disable RLS on 'student_documents' or add a policy allowing inserts for authenticated users.`);
            } else {
                logger.error(`[DATABASE_ERROR] upsert student_documents failed: ${dbError.message}`);
            }

            // Cleanup storage if DB insert fails
            await deleteFromSupabase(uploadResult.path, 'study-materials');
            throw dbError;
        }

        // Log audit action
        try {
            await auditService.logAction({
                employeeId: req.user?.id || null,
                action: 'DOCUMENT_UPLOADED',
                metadata: { registrationId, docId, documentId: document.id, by: req.user?.role || 'STUDENT' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        } catch (auditErr) {
            logger.error(`[AUDIT_ERROR] logAction failed: ${auditErr.message}`);
            // Don't throw here, the upload was successful
        }

        res.json({
            success: true,
            msg: 'Document uploaded successfully',
            document
        });
    } catch (err) {
        logger.error(`[UPLOAD_FATAL_ERROR] ${err.message}`);
        logger.error(`Stack: ${err.stack}`);
        logger.error(`Details - reg: ${req.body.registrationId}, docId: ${req.body.docId}`);
        res.status(500).json({
            msg: 'Server Error',
            error: err.message,
            details: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
};

// @route   PATCH api/documents/:id/verify
// @desc    Verify or reject a student document (Dual Access: Counselor or Admission)
// @access  Employee (Internal)
exports.verifyDocument = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        const { id } = req.params;

        if (!['VERIFIED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ msg: 'Invalid status. Use VERIFIED or REJECTED' });
        }

        // Determine action role based on user department or role
        const actionRole = req.user.dept?.toUpperCase() === 'ADMISSION' ? 'ADMISSION' : 'COUNSELLOR';

        const updateData = {
            updated_at: new Date().toISOString()
        };

        if (actionRole === 'ADMISSION') {
            updateData.a_status = status;
            updateData.a_remarks = remarks;
            updateData.a_by = req.user.id;
            updateData.a_at = new Date().toISOString();
        } else {
            updateData.c_status = status;
            updateData.c_remarks = remarks;
            updateData.c_by = req.user.id;
            updateData.c_at = new Date().toISOString();
        }

        // Fetch current doc to calculate combined status
        const { data: currentDoc } = await supabase
            .from('student_documents')
            .select('c_status, a_status')
            .eq('id', id)
            .single();

        // Calculate final status
        // Rules: 
        // 1. If either is REJECTED -> status = REJECTED
        // 2. If Admission is VERIFIED -> status = VERIFIED (Final Authority)
        // 3. Otherwise, if Counsellor is VERIFIED -> status = 'PARTIALLY_VERIFIED'
        // 4. Default -> UPLOADED

        const nextC = actionRole === 'COUNSELLOR' ? status : (currentDoc?.c_status || 'PENDING');
        const nextA = actionRole === 'ADMISSION' ? status : (currentDoc?.a_status || 'PENDING');

        if (nextC === 'REJECTED' || nextA === 'REJECTED') {
            updateData.status = 'REJECTED';
        } else if (nextA === 'VERIFIED') {
            updateData.status = 'VERIFIED';
        } else if (nextC === 'VERIFIED') {
            updateData.status = 'UPLOADED'; // Stay as uploaded or 'PARTIALLY_VERIFIED'
        } else {
            updateData.status = 'UPLOADED';
        }

        // Compatibility for old fields
        updateData.remarks = remarks;
        updateData.action_by = req.user.id;
        updateData.action_role = actionRole;
        updateData.action_at = new Date().toISOString();

        const { data: document, error } = await supabase
            .from('student_documents')
            .update(updateData)
            .eq('id', id)
            .select('*, registrations(name, email)')
            .single();

        if (error) throw error;

        // If rejected, send email notification to student
        if (status === 'REJECTED') {
            try {
                const student = document.registrations;
                if (student && student.email) {
                    await emailService.sendEmail(
                        student.email,
                        `Action Required: Document Rejected - ${document.doc_id}`,
                        `<h2>Document Rejection Notice</h2>
                         <p>Dear ${student.name},</p>
                         <p>Your document "<strong>${document.doc_id}</strong>" has been rejected because:</p>
                         <p style="color: red; background: #fff5f5; padding: 10px; border-radius: 4px;">${remarks || 'No reason specified'}</p>
                         <p>Please log in to your Student Portal to re-upload the correct document.</p>
                         <p>Thank you,<br/>Team JV Overseas</p>`
                    );
                }
            } catch (emailErr) {
                logger.error(`Failed to send rejection email: ${emailErr.message}`);
            }
        }

        // Log audit action
        await auditService.logAction({
            employeeId: req.user.id,
            action: `DOCUMENT_${status}`,
            metadata: {
                documentId: id,
                registrationId: document.registration_id,
                role: actionRole,
                doc_id: document.doc_id
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            success: true,
            msg: `Document ${status.toLowerCase()} by ${actionRole}`,
            document
        });
    } catch (err) {
        logger.error(`verifyDocument Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   GET api/documents/registration/:registrationId
// @desc    Get all documents for a registration
// @access  Authenticated
exports.getStudentDocuments = async (req, res) => {
    try {
        const { registrationId } = req.params;

        const { data: documents, error } = await supabase
            .from('student_documents')
            .select('*, registrations(name, email)')
            .eq('registration_id', registrationId)
            .order('uploaded_at', { ascending: false });

        if (error) throw error;

        // Generate signed URLs for each document
        const documentsWithUrls = await Promise.all(documents.map(async (doc) => {
            const signedUrl = await generateSignedUrl(doc.file_path, 'study-materials');
            return { ...doc, file_url: signedUrl };
        }));

        res.json(documentsWithUrls);
    } catch (err) {
        logger.error(`getStudentDocuments Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};
// @route   DELETE api/documents/:id
// @desc    Delete a student document
// @access  Internal (Employee)
exports.deleteDocument = async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch document to get file path
        const { data: doc, error: fetchErr } = await supabase
            .from('student_documents')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !doc) {
            return res.status(404).json({ msg: 'Document not found' });
        }

        // 1. Delete from storage if path exists
        if (doc.file_path) {
            await deleteFromSupabase(doc.file_path, 'study-materials');
        }

        // 2. Delete from DB
        const { error: deleteErr } = await supabase
            .from('student_documents')
            .delete()
            .eq('id', id);

        if (deleteErr) throw deleteErr;

        // Log audit
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'DOCUMENT_DELETED',
            metadata: {
                documentId: id,
                registrationId: doc.registration_id,
                doc_id: doc.doc_id,
                file_name: doc.file_name
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ success: true, msg: 'Document deleted successfully' });
    } catch (err) {
        logger.error(`deleteDocument Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};
