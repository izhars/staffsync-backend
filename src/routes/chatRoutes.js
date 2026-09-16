const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const groupAuth = require('../middleware/groupAuth');
const chatController = require('../controllers/chatController');
const { upload, groupUpload, chatProfileUpload, profileUpload } = require('../middleware/upload'); // Multer

router.get('/conversations', auth.protect, chatController.getUserConversations);
router.get('/conversations/:id', auth.protect, chatController.getConversationById);
router.get('/conversations/:id/messages', auth.protect, chatController.getConversationMessages);
router.get('/groups/joined', auth.protect, chatController.getMyJoinedGroups);
// ====================
// 📁 GROUP MANAGEMENT
// ====================
router.post('/conversations/group', auth.protect, auth.managerAndAbove, groupUpload.single('avatar'), chatController.createGroupConversation);
router.put('/conversations/group/:id/avatar', auth.protect, groupAuth.getGroup,groupUpload.single('avatar'), chatController.updateGroupAvatar);
router.delete('/conversations/group/:id/avatar', auth.protect, groupAuth.getGroup,chatController.removeGroupAvatar);
router.get('/conversations/group/:groupId', auth.protect, groupAuth.getGroup, groupAuth.publicOrMember, chatController.getGroupInfo);
router.delete('/conversations/group/:groupId', auth.protect, groupAuth.getGroup, groupAuth.ownerOnly, chatController.deleteGroupConversation);
router.patch('/conversations/group/:groupId/make-admin', auth.protect, groupAuth.getGroup, groupAuth.ownerOnly, groupAuth.cannotTargetOwner, chatController.makeGroupAdmin);
router.patch('/conversations/group/:groupId/remove-admin', auth.protect, groupAuth.getGroup, groupAuth.ownerOnly, groupAuth.cannotTargetOwner, chatController.removeGroupAdmin);
router.post('/conversations/group/:groupId/members', auth.protect, groupAuth.getGroup, groupAuth.adminOrOwner, groupAuth.checkGroupSize, chatController.addGroupMember);
router.delete('/conversations/group/:groupId/members/:userId', auth.protect, groupAuth.getGroup, groupAuth.ownerOnly, groupAuth.cannotTargetOwner, chatController.removeGroupMember);
router.patch('/conversations/group/:groupId/leave', auth.protect, groupAuth.getGroup, groupAuth.memberOnly, chatController.leaveGroup);
router.put('/conversations/group/:groupId/settings', auth.protect, groupAuth.getGroup, groupAuth.canModifySettings, chatController.updateGroupSettings);
router.get('/conversations/group/:groupId/members', auth.protect, groupAuth.getGroup, groupAuth.publicOrMember, chatController.getGroupMembers);
router.get('/conversations/group/:groupId/users', auth.protect, groupAuth.getGroup, groupAuth.adminOrOwner, chatController.getGroupUsersSplit);

// ====================
// 💬 CONVERSATION MANAGEMENT
// ====================
router.put('/conversations/:id', auth.protect, chatController.updateConversation);
router.post('/conversations/:id/archive', auth.protect, chatController.archiveConversation);
router.get('/search', auth.protect, chatController.search);
router.get('/unread-count', auth.protect, chatController.getUnreadCount);
router.get('/direct/:targetUserId', auth.protect, chatController.getOrCreateDirectConversation);

module.exports = router;
