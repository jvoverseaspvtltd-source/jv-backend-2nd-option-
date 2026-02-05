const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('./audit.service');

class LeadService {
    /**
     * Automatically assigns a lead to an eligible employee using logic:
     * 1. Status = ACTIVE
     * 2. Role = 'counsellor', 'wfh', 'admission'
     * 3. Max active leads < 10
     * 4. Round Robin (Least recently assigned)
     * @param {string} leadId 
     * @param {string} departmentId (optional) 
     */
    async assignLead(leadId, departmentId = null) {
        try {
            logger.info(`[LeadAssignment] Starting assignment for lead ${leadId}`);

            // 1. Fetch Lead to ensure it exists and wasn't just assigned
            const { data: lead, error: leadError } = await supabase
                .from('leads')
                .select('*')
                .eq('id', leadId)
                .single();

            if (leadError || !lead) throw new Error('Lead not found');
            if (lead.is_assigned) {
                logger.info(`[LeadAssignment] Lead ${leadId} already assigned to ${lead.assigned_to}`);
                return null;
            }

            // 2. Fetch Eligible Employees
            let query = supabase
                .from('employees')
                .select(`
                    id, name, email, last_lead_assigned_at,
                    roles(name)
                `)
                .eq('status', 'ACTIVE'); // Only active employees

            if (departmentId) {
                query = query.eq('department_id', departmentId);
            }

            const { data: employees, error: empError } = await query;
            if (empError) throw empError;

            // Filter by Roles (Counsellor, WFH, Admission)
            // Normalized role check
            const ELIGIBLE_ROLES = ['counsellor', 'wfh', 'admission', 'admission_officer'];

            const candidates = employees.filter(emp => {
                const roleName = emp.roles?.name ? emp.roles.name.toLowerCase() : '';
                return ELIGIBLE_ROLES.some(r => roleName.includes(r));
            });

            if (candidates.length === 0) {
                logger.warn('[LeadAssignment] No eligible employees found for assignment');
                return null; // Leave unassigned (General Pool)
            }

            // 3. Check Current Load (Max 10 Active Leads)
            // We need to query lead counts for each candidate.
            // Optimization: Do a grouped count query implies filtering. 
            // Since Supabase/PostgREST doesn't support easy 'group by' for this logic in one go freely,
            // we might have to loop or use a custom RPC.
            // For now, let's just loop (assuming employee count is < 50, it's fast enough).
            // "Performance Note": If 1000 employees, this is bad. But for < 50, it's < 100ms.

            const qualifiedCandidates = [];

            for (const candidate of candidates) {
                const { count, error: countError } = await supabase
                    .from('leads')
                    .select('id', { count: 'exact', head: true })
                    .eq('assigned_to', candidate.id)
                    .neq('status', 'REJECTED')
                    .neq('status', 'CONVERTED')
                    .neq('status', 'DEAD'); // Optional: Exclude Dead leads too if you have that status

                if (countError) continue;

                if (count < 10) {
                    qualifiedCandidates.push({
                        ...candidate,
                        currentLoad: count
                    });
                }
            }

            if (qualifiedCandidates.length === 0) {
                logger.warn('[LeadAssignment] All eligible employees match max capacity (10 leads). Lead sent to General Pool.');
                return null;
            }

            // 4. Round Robin Selection (Sort by last_lead_assigned_at ASC)
            // Oldest timestamp (or null) comes first.
            qualifiedCandidates.sort((a, b) => {
                if (!a.last_lead_assigned_at) return -1; // Never assigned -> Top priority
                if (!b.last_lead_assigned_at) return 1;
                return new Date(a.last_lead_assigned_at) - new Date(b.last_lead_assigned_at);
            });

            const selectedEmployee = qualifiedCandidates[0];

            logger.info(`[LeadAssignment] Selected ${selectedEmployee.name} (Load: ${selectedEmployee.currentLoad}, Last: ${selectedEmployee.last_lead_assigned_at})`);

            // 5. Assign Lead
            // Update Lead
            const { error: updateError } = await supabase
                .from('leads')
                .update({
                    assigned_to: selectedEmployee.id,
                    assigned_at: new Date().toISOString(),
                    status: 'ASSIGNED', // Or keep original status? Usually 'ASSIGNED' is better for workflow.
                    is_assigned: true
                })
                .eq('id', leadId);

            if (updateError) throw updateError;

            // Update Employee (last_lead_assigned_at)
            await supabase
                .from('employees')
                .update({ last_lead_assigned_at: new Date().toISOString() })
                .eq('id', selectedEmployee.id);

            // Audit Log
            await auditService.logAction({
                action: 'LEAD_AUTO_ASSIGNED',
                metadata: {
                    leadId,
                    assignedTo: selectedEmployee.id,
                    load: selectedEmployee.currentLoad + 1
                },
                ip: 'SYSTEM',
                employeeId: selectedEmployee.id // Log against the employee or system? System usually.
            });

            return selectedEmployee;

        } catch (error) {
            logger.error(`[LeadAssignment] Error: ${error.message}`);
            return null; // Fail gracefully, leave unassigned
        }
    }
}

module.exports = new LeadService();
