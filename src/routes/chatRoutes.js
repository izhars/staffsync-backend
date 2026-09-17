// routes/chatRoutes.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const groupAuth = require('../middleware/groupAuth');
const chatController = require('../controllers/chatController');
const {
  groupUpload,
  chatProfileUpload,
  profileUpload,
} = require('../middleware/upload');

// ====================
// 💬 CONVERSATIONS (read)
// ====================
router.get('/conversations', auth.protect, chatController.getUserConversations);
router.get('/conversations/:id', auth.protect, chatController.getConversationById);
router.get('/conversations/:id/messages', auth.protect, chatController.getConversationMessages);
router.get('/groups/joined', auth.protect, chatController.getMyJoinedGroups);

// ====================
// 📁 GROUP MANAGEMENT
// ====================

// Create group — any employee can create (remove managerAndAbove if not required)
router.post(
  '/conversations/group',
  auth.protect,
  groupUpload.single('avatar'),
  chatController.createGroupConversation
);

// ✅ FIXED: use :groupId (not :id) + add adminOrOwner guard
router.put(
  '/conversations/group/:groupId/avatar',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.adminOrOwner,
  groupUpload.single('avatar'),
  chatController.updateGroupAvatar
);

// ✅ FIXED: same — param name and permission guard
router.delete(
  '/conversations/group/:groupId/avatar',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.adminOrOwner,
  chatController.removeGroupAvatar
);

router.get(
  '/conversations/group/:groupId',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.publicOrMember,
  chatController.getGroupInfo
);

router.delete(
  '/conversations/group/:groupId',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.ownerOnly,
  chatController.deleteGroupConversation
);

router.patch(
  '/conversations/group/:groupId/make-admin',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.ownerOnly,
  groupAuth.cannotTargetOwner,
  chatController.makeGroupAdmin
);

router.patch(
  '/conversations/group/:groupId/remove-admin',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.ownerOnly,
  groupAuth.cannotTargetOwner,
  chatController.removeGroupAdmin
);

router.post(
  '/conversations/group/:groupId/members',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.adminOrOwner,
  groupAuth.checkGroupSize,
  chatController.addGroupMember
);

router.delete(
  '/conversations/group/:groupId/members/:userId',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.ownerOnly,
  groupAuth.cannotTargetOwner,
  chatController.removeGroupMember
);

router.patch(
  '/conversations/group/:groupId/leave',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.memberOnly,
  chatController.leaveGroup
);

router.put(
  '/conversations/group/:groupId/settings',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.canModifySettings,
  chatController.updateGroupSettings
);

router.get(
  '/conversations/group/:groupId/members',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.publicOrMember,
  chatController.getGroupMembers
);

router.get(
  '/conversations/group/:groupId/users',
  auth.protect,
  groupAuth.getGroup,
  groupAuth.adminOrOwner,
  chatController.getGroupUsersSplit
);

// ====================
// 💬 CONVERSATION MANAGEMENT
// ====================
router.put('/conversations/:id', auth.protect, chatController.updateConversation);
router.post('/conversations/:id/archive', auth.protect, chatController.archiveConversation);
router.get('/search', auth.protect, chatController.search);
router.get('/unread-count', auth.protect, chatController.getUnreadCount);
router.get('/direct/:targetUserId', auth.protect, chatController.getOrCreateDirectConversation);

module.exports = router;