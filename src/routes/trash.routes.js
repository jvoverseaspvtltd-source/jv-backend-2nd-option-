const express = require('express');
const router = express.Router();
const trashController = require('../controllers/trash.controller');
const auth = require('../middleware/auth');

// All cancelled-rejected routes require authentication
router.get('/', auth, trashController.getCancelledRejected);
router.post('/restore/:id', auth, trashController.restoreItem);
router.delete('/purge/:id', auth, trashController.purgeItem);

module.exports = router;
