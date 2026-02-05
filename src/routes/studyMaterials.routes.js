const express = require('express');
const router = express.Router();
const materialController = require('../controllers/studyMaterials.controller');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { studyUpload } = require('../middleware/storage.middleware');

// Base prefix defined in index.js: /api/study-materials

/**
 * ADMIN ROUTES (Super Admin Only)
 */
router.post('/',
    auth,
    checkRole(['super_admin', 'SUPER_ADMIN']),
    studyUpload.single('file'),
    materialController.createMaterial
);

router.put('/:id',
    auth,
    checkRole(['super_admin', 'SUPER_ADMIN']),
    studyUpload.single('file'),
    materialController.updateMaterial
);

router.delete('/:id',
    auth,
    checkRole(['super_admin', 'SUPER_ADMIN']),
    materialController.deleteMaterial
);

/**
 * SHARED / EMPLOYEE ROUTES
 */
router.get('/',
    auth,
    (req, res, next) => {
        const role = (req.user.role || '').toLowerCase();
        if (['counsellor', 'counselling_admin'].includes(role)) {
            return res.status(403).json({ msg: 'Access denied: Feature removed for Counselor Department' });
        }
        next();
    },
    materialController.getMaterials
);

router.post('/:id/track',
    auth,
    materialController.trackEngagement
);

router.post('/:id/bookmark',
    auth,
    materialController.toggleBookmark
);

router.get('/:id/link',
    auth,
    materialController.getMaterialLink
);

module.exports = router;
