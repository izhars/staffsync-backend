const express = require('express');
const router = express.Router();
const { upload, groupUpload, chatProfileUpload, profileUpload } = require('../middleware/upload');
const { protect } = require('../middleware/auth');
const uploadController = require('../controllers/uploadController');

router.post('/upload', protect, upload.single('file'), uploadController.uploadFile);
router.post('/group-avatar', protect, groupUpload.single('avatar'), uploadController.uploadGroupAvatar);
router.post('/profile-picture', protect, profileUpload.single('avatar'), uploadController.uploadProfilePicture);
router.post('/chat-profile', protect, chatProfileUpload.single('avatar'), uploadController.uploadChatProfile);
router.post('/upload-multiple', protect, upload.array('files', 10), uploadController.uploadMultipleFiles);
router.delete('/delete/:publicId', protect, uploadController.deleteFile);
router.get('/sign-upload', protect, uploadController.getSignedUploadUrl);

module.exports = router;