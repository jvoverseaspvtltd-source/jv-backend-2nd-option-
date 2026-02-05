const express = require('express');
const router = express.Router();
const counsellorController = require('../controllers/counsellor.controller');
const auth = require('../middleware/auth');
const ownershipGuard = require('../middleware/ownershipGuard');

// Lead Management
router.post('/leads', auth, counsellorController.createLead);
router.get('/leads/general', auth, counsellorController.getGeneralLeads);
router.get('/leads/my-leads', auth, counsellorController.getMyLeads);
router.get('/leads/my-follow-ups', auth, counsellorController.getMyFollowUps);
router.get('/leads/:id', auth, counsellorController.getLeadById);
router.put('/leads/:id', auth, counsellorController.updateLead);
router.post('/leads/:id/assign', auth, counsellorController.assignLead);
router.post('/leads/:id/call-log', auth, counsellorController.addCallLog);
router.post('/leads/:id/follow-up', auth, counsellorController.addFollowUp);
router.post('/leads/:id/interaction', auth, counsellorController.submitInteraction);
router.delete('/leads/:id', auth, counsellorController.softDeleteLead);
router.post('/leads/bulk-delete', auth, counsellorController.bulkDeleteLeads);
router.post('/leads/:id/restore', auth, counsellorController.restoreLead);
router.get('/leads/:id/audit', auth, counsellorController.getLeadAuditLogs);

// Registration & Student Management
router.post('/leads/:id/register', auth, counsellorController.registerStudent);
router.patch('/registrations/:id/complete-task', [auth, ownershipGuard], counsellorController.completeCounsellorTask);
router.post('/registrations/:id/close', auth, counsellorController.closeRegistration);
router.get('/registrations/my', auth, counsellorController.getMyRegistrations);

// Trash Leads (Admin Only)
router.get('/trash-leads', counsellorController.getTrashLeads);
router.post('/trash-leads/:id/restore', counsellorController.restoreRejectedLead);
router.post('/trash-leads/:id/reassign', counsellorController.reassignRejectedLead);

module.exports = router;
