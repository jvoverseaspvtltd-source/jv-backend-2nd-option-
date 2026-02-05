const express = require('express');
const router = express.Router();
const fieldAgentController = require('../controllers/field-agent.controller');
const auth = require('../middleware/auth');

// Dashboard
router.get('/dashboard', auth, fieldAgentController.getDashboardStats);

// Registrations
router.get('/registrations', auth, fieldAgentController.getRegistrations);
router.get('/registrations/:id/documents', auth, fieldAgentController.getLoanDocuments);
router.post('/registrations/:id/documents', auth, fieldAgentController.uploadLoanDocument);
router.post('/registrations/:id/transfer-veda', auth, fieldAgentController.transferToVeda);

// Documents
router.patch('/documents/:docId/status', auth, fieldAgentController.updateDocumentStatus);

// Tasks
router.get('/tasks', auth, fieldAgentController.getTasks);
router.post('/tasks', auth, fieldAgentController.createTask);
router.patch('/tasks/:id/status', auth, fieldAgentController.updateTaskStatus);

module.exports = router;
