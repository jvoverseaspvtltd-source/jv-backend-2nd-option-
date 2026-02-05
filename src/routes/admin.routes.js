const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const adminController = require('../controllers/admin.controller');
const { check } = require('express-validator');

// Validation for login
const loginValidation = [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists()
];

const otpValidation = [
    check('email', 'Please include a valid email').isEmail(),
    check('otp', 'OTP is required').isLength({ min: 4 })
];

// Routes
router.post('/gate', adminController.gate);
router.post('/login', loginValidation, adminController.login);
router.post('/verify-otp', otpValidation, adminController.verifyOtp);
router.post('/refresh-token', adminController.refreshToken);
router.post('/logout', auth, adminController.logout);

// Late Login Workflow (Public/Protected)
router.post('/late-login-request', adminController.requestLateLogin);
router.get('/late-requests', [auth, isAdmin], adminController.getPendingLateRequests);
router.post('/late-requests/:id/action', [auth, isAdmin], adminController.manageLateLogin);

// Protected Admin Routes
// Protected Admin Routes
router.get('/leads', [auth, isAdmin], adminController.getLeads);
router.get('/enquiries', [auth, isAdmin], adminController.getEnquiries);
router.get('/eligibility-records', [auth, isAdmin], adminController.getEligibilityRecords);

// Dashboard & Monitoring Routes
router.get('/stats/system', [auth, isAdmin], adminController.getSystemStats);
router.get('/stats/departments', [auth, isAdmin], adminController.getDepartmentStats);
router.get('/monitoring/performance', [auth, isAdmin], adminController.getPerformanceStats);
router.get('/monitoring/follow-ups', [auth, isAdmin], adminController.getFollowUpMonitoring);
router.get('/monitoring/employee/:id', [auth, isAdmin], adminController.getEmployeeMonitoring);
router.get('/audit-logs', [auth, isAdmin], adminController.getAuditLogs);
router.get('/sessions', [auth, isAdmin], adminController.getActiveSessions);

// Profile Management Routes
const upload = require('../middleware/upload');

router.get('/profile', auth, adminController.getProfile);
router.put('/profile', auth, adminController.updateProfile);
router.post('/profile/photo', [auth, upload.single('photo')], adminController.uploadProfilePhoto);
router.delete('/profile/photo', auth, adminController.removeProfilePhoto);
router.put('/profile/password', auth, adminController.changePassword);
router.post('/profile/password/request-otp', adminController.requestPasswordResetOtp);
router.post('/profile/password/reset-with-otp', adminController.resetPasswordWithOtp);
router.get('/profile/activity', auth, adminController.getRecentActivity);

// Employee Management Routes
router.get('/department-admins', [auth, isAdmin], adminController.getDepartmentAdmins);
router.get('/departments', auth, adminController.getDepartments);
router.get('/teammates', auth, adminController.listTeammates);
router.get('/employees', [auth, isAdmin], adminController.listEmployees);
router.post('/employees/request-otp', [auth, isAdmin], adminController.requestEmployeeCreationOtp);
router.post('/employees', [auth, isAdmin], adminController.createEmployee);
router.get('/employees/:id', [auth, isAdmin], adminController.getEmployeeDetail);
router.put('/employees/:id', [auth, isAdmin], adminController.updateEmployee);
router.patch('/employees/:id/status', [auth, isAdmin], adminController.toggleEmployeeStatus);
router.post('/employees/:id/reset-password', [auth, isAdmin], adminController.resetEmployeePassword);
router.delete('/employees/:id', [auth, isAdmin], adminController.deleteEmployee);

// Registration Management
router.delete('/registrations/:id/test', [auth, isAdmin], adminController.deleteTestRegistration);

module.exports = router;
