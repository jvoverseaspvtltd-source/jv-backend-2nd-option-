const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');

/**
 * Service to handle registration workflow state transitions reliably.
 */
class WorkflowStateService {
    /**
     * Transition a registration to a new owner or state.
     * @param {string} registrationId 
     * @param {string} newOwner - COUNSELLOR, ADMISSION, etc.
     * @param {object} workflowUpdates - Additional fields to update in the workflow JSONB
     * @param {object} reqUser - The user performing the action (for audit)
     */
    async transitionState(registrationId, newOwner, workflowUpdates = {}, reqUser) {
        try {
            // 1. Fetch current registration
            const { data: registration, error: fetchError } = await supabase
                .from('registrations')
                .select('workflow')
                .eq('id', registrationId)
                .single();

            if (fetchError || !registration) throw new Error('Registration not found');

            const currentWorkflow = registration.workflow || {};

            // 2. Prepare updated workflow
            const updatedWorkflow = {
                ...currentWorkflow,
                ...workflowUpdates,
                currentOwner: newOwner,
                lastTransitionedAt: new Date().toISOString(),
                lastTransitionedBy: reqUser.id
            };

            // 3. Update database
            const { data: updatedRegistration, error: updateError } = await supabase
                .from('registrations')
                .update({
                    workflow: updatedWorkflow,
                    updated_at: new Date().toISOString()
                })
                .eq('id', registrationId)
                .select()
                .single();

            if (updateError) throw updateError;

            // 4. Log Audit
            await auditService.logAction({
                employeeId: reqUser.id,
                action: 'WORKFLOW_TRANSITION',
                metadata: {
                    registrationId,
                    previousOwner: currentWorkflow.currentOwner,
                    newOwner,
                    workflowUpdates
                },
                ip: 'internal', // This is service level
                userAgent: 'WorkflowStateService'
            });

            return updatedRegistration;
        } catch (err) {
            logger.error(`WorkflowStateService Error: ${err.message}`);
            throw err;
        }
    }

    /**
     * Check if all required documents for a specific department are uploaded and verified.
     * @param {string} registrationId 
     * @param {Array} requiredDocIds - List of doc IDs from documentConfig.js
     */
    async checkDocumentCompleteness(registrationId, requiredDocIds) {
        try {
            const { data: docs, error } = await supabase
                .from('student_documents')
                .select('doc_id, status')
                .eq('registration_id', registrationId);

            if (error) throw error;

            const uploadedDocIds = docs
                .filter(d => ['UPLOADED', 'VERIFIED'].includes(d.status))
                .map(d => d.doc_id);

            const missingDocs = requiredDocIds.filter(id => !uploadedDocIds.includes(id));

            return {
                isComplete: missingDocs.length === 0,
                missingDocs,
                progress: Math.round(((requiredDocIds.length - missingDocs.length) / requiredDocIds.length) * 100)
            };
        } catch (err) {
            logger.error(`checkDocumentCompleteness Error: ${err.message}`);
            throw err;
        }
    }
}

module.exports = new WorkflowStateService();
