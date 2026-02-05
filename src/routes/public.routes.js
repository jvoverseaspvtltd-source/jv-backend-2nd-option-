const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');
const { check } = require('express-validator');

// Validation
const leadValidation = [
    check('name', 'Name is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check('phone', 'Phone is required').not().isEmpty(),
    check('serviceType', 'Service Type is required').not().isEmpty()
];

const eligibilityValidation = [
    check('email', 'Email is required').isEmail(),
    check('phone', 'Phone is required').not().isEmpty(),
];

router.post('/intake', leadValidation, publicController.intake);
router.post('/eligibility-check', eligibilityValidation, publicController.checkEligibility);
router.post('/comprehensive-eligibility', publicController.comprehensiveEligibility);
router.post('/chat-message', publicController.chatMessage);
router.post('/chat-conversation', publicController.chatConversation);
router.get('/content', publicController.getContent);

module.exports = router;
