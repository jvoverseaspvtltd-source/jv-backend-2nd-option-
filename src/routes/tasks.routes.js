const express = require('express');
const router = express.Router();
const tasksController = require('../controllers/tasks.controller');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

router.use(auth); // All task routes require authentication

router.get('/', (req, res, next) => {
    const role = (req.user.role || '').toLowerCase();
    if (['counsellor', 'counselling_admin'].includes(role)) {
        return res.status(403).json({ msg: 'Access denied: Feature removed for Counselor Department' });
    }
    next();
}, tasksController.getTasks);
router.post('/', checkRole(['super_admin', 'dept_admin']), tasksController.createTask);
router.put('/:id', checkRole(['super_admin', 'dept_admin']), tasksController.updateTask);
router.delete('/:id', checkRole(['super_admin', 'dept_admin']), tasksController.deleteTask);
router.get('/:id/history', tasksController.getTaskHistory);
router.patch('/:id/status', tasksController.updateTaskStatus);

module.exports = router;
