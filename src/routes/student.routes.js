const express = require('express');
const router = express.Router();
const studentController = require('../controllers/student.controller');
const studentPaymentController = require('../controllers/student-payment.controller');
const authMiddleware = require('../middleware/auth');

// Authentication
router.post('/login', studentController.login);
router.post('/refresh-token', studentController.refreshToken);
router.post('/logout', authMiddleware, studentController.logout);

// Dashboard
router.get('/me', authMiddleware, studentController.getDashboard);

// Payment Routes
router.get('/payments/overview', authMiddleware, studentPaymentController.getPaymentOverview);
router.get('/payments/history', authMiddleware, studentPaymentController.getPaymentHistory);
router.get('/payments/access-flags', authMiddleware, studentPaymentController.getAccessFlags);

// Profile & Auth
router.post('/request-reset', studentController.requestPasswordReset);
router.post('/reset-password', studentController.resetPassword);
router.put('/profile', authMiddleware, studentController.updateProfile);
router.get('/my-applications', authMiddleware, studentController.getMyApplications);

module.exports = router;
