const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications.controller');
const auth = require('../middleware/auth');

router.use(auth); // All notification routes require authentication

router.get('/', notificationsController.getMyNotifications);
router.patch('/:id/read', notificationsController.markAsRead);
router.patch('/read-all', notificationsController.markAllAsRead);

module.exports = router;
