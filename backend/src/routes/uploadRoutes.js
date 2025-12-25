const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/init', uploadController.initializeUpload);
router.post('/finalize', uploadController.finalizeUpload);
// Using params for cleaner binary body handling
router.post('/:upload_id/chunk/:chunk_index', uploadController.uploadChunk);

module.exports = router;
