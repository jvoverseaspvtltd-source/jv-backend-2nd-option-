const express = require('express');
const router = express.Router();
const queriesController = require('../controllers/queries.controller');
const auth = require('../middleware/auth');

// All routes are protected
router.use(auth);

// @route   POST api/queries
// @desc    Create a new query
router.post('/', queriesController.createQuery);

// @route   GET api/queries
// @desc    Get list of queries
router.get('/', queriesController.getQueries);

// @route   GET api/queries/:id
// @desc    Get single query with chat history
router.get('/:id', queriesController.getQueryDetails);

// @route   POST api/queries/:id/messages
// @desc    Send a message in the query chat
router.post('/:id/messages', queriesController.sendMessage);

// @route   PATCH api/queries/:id
// @desc    Update status or assignment (Employees only)
router.patch('/:id', queriesController.updateQuery);

module.exports = router;
