const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const notesController = require('../controllers/notes.controller');

// All routes require authentication and admin privileges
router.get('/:id/notes', [auth, isAdmin], notesController.getNotes);
router.post('/:id/notes', [auth, isAdmin], notesController.createNote);
router.put('/:id/notes/:noteId', [auth, isAdmin], notesController.updateNote);
router.delete('/:id/notes/:noteId', [auth, isAdmin], notesController.deleteNote);

module.exports = router;
