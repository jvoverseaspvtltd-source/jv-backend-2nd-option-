const express = require('express');
const router = express.Router();
const empQueriesController = require('../controllers/empQueries.controller');
const auth = require('../middleware/auth');

// All internal support routes are protected
router.use(auth);

// @route   POST api/emp-queries
// @desc    Create a new internal query
router.post('/', empQueriesController.createEmpQuery);

// @route   GET api/emp-queries
// @desc    Get list of internal queries
router.get('/', empQueriesController.getEmpQueries);

// @route   GET api/emp-queries/:id
// @desc    Get single internal query with chat history
router.get('/:id', empQueriesController.getEmpQueryDetails);

// @route   POST api/emp-queries/:id/messages
// @desc    Send a message in the internal query chat
router.post('/:id/messages', empQueriesController.sendEmpMessage);

// @route   PATCH api/emp-queries/:id
// @desc    Update status or assignment (Admins only)
router.patch('/:id', empQueriesController.updateEmpQuery);

module.exports = router;
