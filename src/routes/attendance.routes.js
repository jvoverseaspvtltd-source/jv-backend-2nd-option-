const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const attendanceController = require('../controllers/attendance.controller');

// All routes require authentication
router.post('/clock-in', auth, attendanceController.clockIn);
router.post('/clock-out', auth, attendanceController.clockOut);
router.post('/break/start', auth, attendanceController.startBreak);
router.post('/break/end', auth, attendanceController.endBreak);
router.get('/:employeeId/monthly', auth, attendanceController.getMonthlyAttendance);
router.get('/:employeeId/history', auth, attendanceController.getAttendanceHistory);
router.patch('/:logId', auth, attendanceController.updateAttendance);
router.post('/export', auth, attendanceController.exportAttendanceReport);

module.exports = router;
