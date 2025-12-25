const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/init', uploadController.initializeUpload);
router.post('/finalize', uploadController.finalizeUpload);

module.exports = router;
