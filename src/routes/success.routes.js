const express = require('express');
const router = express.Router();
const successController = require('../controllers/success.controller');
const auth = require('../middleware/auth');

router.use(auth);

router.post('/', successController.createSuccessRecord);
router.get('/', successController.getSuccessRecords);

module.exports = router;
