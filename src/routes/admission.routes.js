const express = require('express');
const router = express.Router();
const admissionController = require('../controllers/admission.controller');
const auth = require('../middleware/auth');
const ownershipGuard = require('../middleware/ownershipGuard');

// Dashboard
router.get('/stats', auth, admissionController.getDashboardStats);

// Registrations
router.get('/registrations/success-registry', auth, admissionController.getSuccessRegistry);
router.get('/registrations', auth, admissionController.getRegistrations);
router.get('/registrations/:id', auth, admissionController.getRegistrationById);
router.post('/registrations/:id/claim', auth, admissionController.claimRegistration);
router.put('/registrations/:id/status', [auth, ownershipGuard], admissionController.updateAdmissionStatus);
router.patch('/registrations/:id/toggle-loan', [auth, ownershipGuard], admissionController.toggleLoanOpted); // NEW
router.patch('/registrations/:id/complete-admission', [auth, ownershipGuard], admissionController.markAdmissionCompleted); // NEW
router.patch('/registrations/:id/complete-loan', [auth, ownershipGuard], admissionController.markLoanCompleted); // NEW
router.patch('/registrations/:id/loan-requirement', auth, admissionController.updateLoanRequirement); // NEW
router.delete('/registrations/:id', [auth, ownershipGuard], admissionController.softDeleteRegistration);
router.post('/registrations/:id/restore', auth, admissionController.restoreRegistration);
router.post('/registrations/:id/cancel', [auth, ownershipGuard], admissionController.cancelAdmission);
router.post('/registrations/:id/defer', [auth, ownershipGuard], admissionController.deferIntake);
router.get('/intake-deferrals', auth, admissionController.getIntakeDeferrals);

// Admission Applications (Page 1)
router.post('/applications', [auth, ownershipGuard], admissionController.createApplication);
router.get('/applications/registration/:registrationId', auth, admissionController.getApplicationsByRegistration);
router.patch('/applications/:id/status', [auth, ownershipGuard], admissionController.updateApplicationStatus);
router.patch('/applications/:id/details', [auth, ownershipGuard], admissionController.updateApplicationDetails); // NEW
router.patch('/applications/:id/details', [auth, ownershipGuard], admissionController.updateApplicationDetails); // NEW

// Offer Letters (Page 2)
router.post('/offer-letters', [auth, ownershipGuard], admissionController.uploadOfferLetter);
router.get('/offer-letters/registration/:registrationId', auth, admissionController.getOfferLetters);

// Loan Applications (Page 3 & 4)
router.get('/loan/registration/:registrationId', auth, admissionController.getLoanApplication);
router.post('/loan', auth, admissionController.upsertLoanApplication);
router.patch('/loan/:id/status', auth, admissionController.updateLoanStatus);
router.post('/loan/payment', auth, admissionController.recordPayment); // NEW
router.patch('/loan/:id/details', auth, admissionController.updateLoanDetails); // NEW

// Tasks
router.get('/tasks', auth, admissionController.getTasks);
router.post('/tasks', auth, admissionController.createTask);
router.patch('/tasks/:id/status', auth, admissionController.updateTaskStatus);

// Announcements
router.get('/announcements', auth, admissionController.getAnnouncements);
router.post('/announcements', auth, admissionController.createAnnouncement);

// Study Materials
router.get('/study-materials', auth, admissionController.getStudyMaterials);
router.post('/study-materials', auth, admissionController.createStudyMaterial);

// Query & Resolution
router.post('/queries', auth, admissionController.logQuery);
router.get('/queries', auth, admissionController.getQueries);
router.post('/queries/:id/resolve', auth, admissionController.resolveQuery);

module.exports = router;
