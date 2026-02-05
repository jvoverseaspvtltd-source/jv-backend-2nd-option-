const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const auth = require('../middleware/auth');
const { studyUpload } = require('../middleware/storage.middleware');

// @route   POST api/documents/upload
router.post('/upload', auth, studyUpload.single('file'), documentController.uploadDocument);

// @route   PATCH api/documents/:id/verify
router.patch('/:id/verify', auth, documentController.verifyDocument);

// @route   GET api/documents/registration/:registrationId
router.get('/registration/:registrationId', auth, documentController.getStudentDocuments);

// @route   DELETE api/documents/:id
router.delete('/:id', auth, documentController.deleteDocument);

module.exports = router;
