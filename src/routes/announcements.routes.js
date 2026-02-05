const express = require('express');
const router = express.Router();
const announcementsController = require('../controllers/announcements.controller');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { studyUpload } = require('../middleware/storage.middleware');

router.use(auth);

// Employee/Global Feed
router.get('/', (req, res, next) => {
    const role = (req.user.role || '').toLowerCase();
    if (['counsellor', 'counselling_admin'].includes(role)) {
        return res.status(403).json({ msg: 'Access denied: Feature removed for Counselor Department' });
    }
    next();
}, announcementsController.getAnnouncements);
router.post('/:id/track', announcementsController.trackEngagement);
router.post('/:id/react', announcementsController.toggleReaction);

// Admin Management
router.post('/', checkRole(['super_admin', 'dept_admin']), announcementsController.createAnnouncement);

router.post('/upload',
    checkRole(['super_admin', 'dept_admin']),
    (req, res, next) => {
        // Access storageMiddleware here to avoid destructuring issues if partially loaded
        const storageMiddleware = require('../middleware/storage.middleware');
        if (!storageMiddleware.studyUpload) {
            console.error('[ERROR] studyUpload is undefined in announcements routes!');
            return res.status(500).json({ msg: 'Internal Server Error: Storage middleware not initialized' });
        }
        return storageMiddleware.studyUpload.single('file')(req, res, next);
    },
    announcementsController.uploadMedia
);
router.delete('/:id', checkRole(['super_admin', 'dept_admin']), announcementsController.deleteAnnouncement);

module.exports = router;
