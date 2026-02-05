const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const auth = require('../middleware/auth');

// All chat routes are protected
router.post('/send', auth, chatController.sendMessage);
router.get('/:deptId', auth, chatController.getMessages);
router.delete('/:messageId', auth, chatController.deleteMessage);

// --- Direct Messaging (1-to-1) ---
router.get('/direct/conversations', auth, chatController.getConversations);
router.get('/direct/:conversationId', auth, chatController.getDirectMessages);
router.post('/direct/send', auth, chatController.sendDirectMessage);

module.exports = router;
