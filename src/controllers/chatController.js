const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { uploadGroupAvatar, deleteFromCloudinary } = require('../middleware/upload');

// Get user's conversations
exports.getUserConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const conversations = await Conversation.find({
      'participants.user': userId,
      'participants.isActive': true,
      isArchived: false
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('participants.user', 'firstName lastName email role profilePicture')
      .populate('lastMessage.senderId', 'firstName lastName')
      .lean();

    const total = await Conversation.countDocuments({
      'participants.user': userId,
      'participants.isActive': true,
      isArchived: false
    });

    res.json({
      success: true,
      data: conversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations'
    });
  }
};

// Get conversation by ID
exports.getConversationById = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id)
      .populate('participants.user', 'firstName lastName email role profilePicture department')
      .populate('createdBy', 'firstName lastName')
      .lean();

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const isParticipant = conversation.participants.some(
      p => p.user._id.toString() === req.user.id
    );

    if (!isParticipant && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this conversation'
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (err) {
    console.error('Error fetching conversation:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversation'
    });
  }
};

// Get messages in conversation
exports.getConversationMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isParticipant(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view messages'
      });
    }

    const messages = await Message.find({ conversationId: id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'firstName lastName role profilePicture')
      .lean();

    const total = await Message.countDocuments({ conversationId: id });

    res.json({
      success: true,
      data: messages.reverse(), // Return oldest first
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
};

// Create new group conversation
exports.createGroupConversation = async (req, res) => {
  try {

    const { name, description, participantIds = [], settings } = req.body;
    const userId = req.user.id;

    if (!name) {
      console.warn('⚠️ Group name missing');
      return res.status(400).json({
        success: false,
        message: 'Group name is required'
      });
    }

    // Handle avatar upload if present
    let avatarUrl = '';
    let avatarPublicId = '';

    if (req.file) {

      try {
        const uploadResult = await uploadGroupAvatar(req.file.buffer, {
          folder: `group_avatars/${userId}`,
          public_id: `group_${Date.now()}`
        });

        avatarUrl = uploadResult.url;
        avatarPublicId = uploadResult.publicId;

      } catch (uploadError) {
        console.error('❌ Avatar upload failed:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload avatar'
        });
      }
    }

    // Combine creator + participants (no duplicates)
    const allParticipantIds = [
      userId,
      ...new Set(participantIds.filter(id => id && id !== userId.toString()))
    ];

    const users = await User.find({ _id: { $in: allParticipantIds } });

    if (users.length !== allParticipantIds.length) {
      console.error('❌ One or more participants not found');
      return res.status(400).json({
        success: false,
        message: 'One or more participants not found'
      });
    }

    const group = new Conversation({
      type: 'group',
      name,
      description: description || '',
      // FIX: Update to match schema structure
      avatar: {
        url: avatarUrl,
        publicId: avatarPublicId
      },
      participants: allParticipantIds.map(id => ({
        user: id,
        role: id.toString() === userId.toString() ? 'owner' : 'member',
        joinedAt: new Date()
      })),
      settings: {
        isPublic: settings?.isPublic ?? false,
        approvalRequired: settings?.approvalRequired ?? false,
        allowMedia: settings?.allowMedia ?? true,
        allowReactions: settings?.allowReactions ?? true,
        allowEditing: settings?.allowEditing ?? true,
        maxParticipants: settings?.maxParticipants || 100
      },
      createdBy: userId
    });

    await group.save();

    const populatedGroup = await Conversation.findById(group._id)
      .populate('participants.user', 'firstName lastName email role profilePicture');

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: populatedGroup
    });
  } catch (err) {
    console.error('🔥 [CREATE GROUP ERROR]', {
      message: err.message,
      stack: err.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create group'
    });
  }
};


// Update group avatar
exports.updateGroupAvatar = async (req, res) => {
  try {
    const group = req.group;
    const userId = req.user.id;

    // Check if user has permission (admin or owner)
    const userRole = group.getUserRole(userId);
    if (!['admin', 'owner'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins or owner can update group avatar'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Avatar image is required'
      });
    }

    // Delete old avatar from Cloudinary if exists
    if (group.avatar && group.avatar.publicId) {
      try {
        await deleteFromCloudinary(group.avatar.publicId);
      } catch (deleteError) {
        console.warn('⚠️ Failed to delete old avatar:', deleteError);
        // Continue with upload even if delete fails
      }
    }

    // Upload new avatar
    const uploadResult = await uploadGroupAvatar(req.file.buffer, {
      folder: `group_avatars/${group._id}`,
      public_id: `group_${group._id}_${Date.now()}`
    });

    // Update group with new avatar - FIXED
    group.avatar = {
      url: uploadResult.url,
      publicId: uploadResult.publicId
    };
    group.updatedAt = new Date();

    await group.save();

    // Populate and return updated group
    const populatedGroup = await Conversation.findById(group._id)
      .populate('participants.user', 'firstName lastName email role profilePicture')
      .lean();

    res.json({
      success: true,
      message: 'Group avatar updated successfully',
      data: populatedGroup
    });
  } catch (err) {
    console.error('Error updating group avatar:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update group avatar'
    });
  }
};

// Remove group avatar
exports.removeGroupAvatar = async (req, res) => {
  try {
    const group = req.group;
    const userId = req.user.id;

    // Check if user has permission
    const userRole = group.getUserRole(userId);
    if (!['admin', 'owner'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only admins or owner can remove group avatar'
      });
    }

    if (!group.avatar || !group.avatar.publicId) {
      return res.status(400).json({
        success: false,
        message: 'Group does not have an avatar'
      });
    }

    // Delete from Cloudinary
    try {
      await deleteFromCloudinary(group.avatar.publicId);
    } catch (deleteError) {
      console.warn('⚠️ Failed to delete avatar from Cloudinary:', deleteError);
    }

    // Remove from database - FIXED
    group.avatar = {
      url: '',
      publicId: ''
    };
    group.updatedAt = new Date();

    await group.save();

    res.json({
      success: true,
      message: 'Group avatar removed successfully'
    });
  } catch (err) {
    console.error('Error removing group avatar:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove group avatar'
    });
  }
};

exports.deleteGroupConversation = async (req, res) => {
  try {
    const group = req.group; // From middleware

    group.isArchived = true;
    group.archivedAt = new Date();

    await group.save();

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting group:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete group'
    });
  }
};

exports.makeGroupAdmin = async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;
    const group = req.group; // From middleware

    // 🎯 Find target participant
    const participant = group.participants.find(
      p => p.user.toString() === targetUserId && p.isActive
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'User not found in group'
      });
    }

    // Don't allow changing owner's role
    if (participant.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change owner role'
      });
    }

    participant.role = 'admin';
    await group.save();

    res.json({
      success: true,
      message: 'User promoted to admin'
    });
  } catch (err) {
    console.error('Make admin error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to assign admin'
    });
  }
};


// Returns list of GROUP conversations the current user is actively participating in
exports.getMyJoinedGroups = async (req, res) => {
  try {
    const userId = req.user.id;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    // 1️⃣ Fetch groups where user is ACTIVE participant
    const groups = await Conversation.find({
      type: 'group',
      participants: {
        $elemMatch: {
          user: userId,
          isActive: true
        }
      },
      isArchived: false
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('participants.user', 'firstName lastName email role profilePicture')
      .populate('lastMessage.senderId', 'firstName lastName profilePicture')
      .populate('createdBy', 'firstName lastName')
      .lean();

    // 2️⃣ Total count for pagination
    const total = await Conversation.countDocuments({
      type: 'group',
      participants: {
        $elemMatch: {
          user: userId,
          isActive: true
        }
      },
      isArchived: false
    });

    // 3️⃣ Add unread count + normalize group avatar
    const groupsWithExtras = await Promise.all(
      groups.map(async (group) => {
        const unreadCount = await Message.countDocuments({
          conversationId: group._id,
          sender: { $ne: userId },
          'readBy.user': { $ne: userId }
        });

        return {
          ...group,
          avatarUrl: group.avatar?.url || '',
          unreadCount
        };
      })
    );

    // 4️⃣ Final response
    res.json({
      success: true,
      data: groupsWithExtras,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('❌ Error fetching joined groups:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch joined groups'
    });
  }
};


// Update conversation
exports.updateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user.id;

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const userRole = conversation.getUserRole(userId);
    if (!['admin', 'owner'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update conversation'
      });
    }

    if (updates.name !== undefined) conversation.name = updates.name;
    if (updates.description !== undefined) conversation.description = updates.description;
    if (updates.avatar !== undefined) conversation.avatar = updates.avatar;
    if (updates.settings) {
      conversation.settings = { ...conversation.settings, ...updates.settings };
    }

    await conversation.save();

    const populated = await Conversation.findById(id)
      .populate('participants.user', 'firstName lastName email role profilePicture');

    res.json({
      success: true,
      message: 'Conversation updated successfully',
      data: populated
    });
  } catch (err) {
    console.error('Error updating conversation:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update conversation'
    });
  }
};


// Archive conversation
exports.archiveConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isParticipant(userId)) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    conversation.isArchived = true;
    conversation.archivedAt = new Date();
    await conversation.save();

    res.json({
      success: true,
      message: 'Conversation archived successfully'
    });
  } catch (err) {
    console.error('Error archiving conversation:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to archive conversation'
    });
  }
};

// Search conversations and messages
exports.search = async (req, res) => {
  try {
    const { q, type = 'all', limit = 20 } = req.query;
    const userId = req.user.id;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const searchRegex = new RegExp(q, 'i');
    let results = { conversations: [], messages: [], users: [] };

    if (type === 'all' || type === 'conversations') {
      const conversations = await Conversation.find({
        'participants.user': userId,
        $or: [
          { name: searchRegex },
          { description: searchRegex }
        ],
        isArchived: false
      })
        .limit(parseInt(limit))
        .populate('participants.user', 'firstName lastName profilePicture')
        .lean();

      results.conversations = conversations;
    }

    if (type === 'all' || type === 'messages') {
      const userConversations = await Conversation.find({
        'participants.user': userId
      }).select('_id');

      const conversationIds = userConversations.map(c => c._id);

      const messages = await Message.find({
        conversationId: { $in: conversationIds },
        text: searchRegex,
        isDeleted: false
      })
        .limit(parseInt(limit))
        .populate('sender', 'firstName lastName profilePicture')
        .populate('conversationId', 'name')
        .lean();

      results.messages = messages;
    }

    if (type === 'all' || type === 'users') {
      const users = await User.find({
        _id: { $ne: userId },
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { employeeId: searchRegex }
        ],
        isActive: true
      })
        .select('firstName lastName email role profilePicture department employeeId')
        .limit(parseInt(limit))
        .lean();

      results.users = users;
    }

    res.json({
      success: true,
      data: results
    });
  } catch (err) {
    console.error('Error searching:', err);
    res.status(500).json({
      success: false,
      message: 'Search failed'
    });
  }
};
// Get unread message count
exports.getUnreadCount = async (req, res) => {

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: userId missing'
      });
    }

    const conversations = await Conversation.find({
      'participants.user': userId,
      'participants.isActive': true,
      isArchived: false
    });

    conversations.forEach((c, i) => {
    });

    const totalUnread = conversations.reduce(
      (sum, conv) => sum + (conv.unreadCount || 0),
      0
    );

    res.json({
      success: true,
      data: {
        totalUnread,
        byConversation: conversations.map(c => ({
          id: c._id,
          unreadCount: c.unreadCount || 0
        }))
      }
    });

  } catch (err) {
    console.error('🔥 [UnreadCount ERROR]', err);
    console.error('🔥 Stack:', err.stack);

    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
};

// Get or create direct conversation with user
exports.getOrCreateDirectConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const targetUserId = req.params.targetUserId;

    if (userId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create conversation with yourself'
      });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let conversation = await Conversation.findOne({
      type: 'direct',
      isDirect: true,
      'participants.user': { $all: [userId, targetUserId] }
    })
      .populate('participants.user', 'firstName lastName email role profilePicture')
      .lean();

    if (!conversation) {
      const newConversation = new Conversation({
        type: 'direct',
        isDirect: true,
        participants: [
          { user: userId, role: 'member', joinedAt: new Date() },
          { user: targetUserId, role: 'member', joinedAt: new Date() }
        ],
        directParticipants: [userId, targetUserId],
        name: 'Direct Chat',
        createdBy: userId,
        settings: {
          isPublic: false,
          approvalRequired: false
        }
      });

      await newConversation.save();

      conversation = await Conversation.findById(newConversation._id)
        .populate('participants.user', 'firstName lastName email role profilePicture')
        .lean();
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (err) {
    console.error('Error getting direct conversation:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversation'
    });
  }
};

// Get group info
exports.getGroupInfo = async (req, res) => {
  try {
    const group = req.group;

    const populatedGroup = await Conversation.findById(group._id)
      .populate('participants.user', 'firstName lastName email role profilePicture')
      .populate('createdBy', 'firstName lastName')
      .lean();

    res.json({
      success: true,
      data: {
        ...populatedGroup,

        // ✅ avatar empty string if not exists
        avatar: {
          url: populatedGroup.avatar?.url || '',
          publicId: populatedGroup.avatar?.publicId || ''
        }
      }
    });
  } catch (err) {
    console.error('❌ Error getting group info:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get group information'
    });
  }
};


// Remove group admin
exports.removeGroupAdmin = async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;
    const group = req.group;

    const participant = group.participants.find(
      p => p.user.toString() === targetUserId && p.isActive
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'User not found in group'
      });
    }

    // Can't remove owner's admin status
    if (participant.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Owner cannot be demoted'
      });
    }

    // Only demote if currently admin
    if (participant.role === 'admin') {
      participant.role = 'member';
      await group.save();

      return res.json({
        success: true,
        message: 'User demoted to member'
      });
    }

    res.json({
      success: true,
      message: 'User is not an admin'
    });
  } catch (err) {
    console.error('Remove admin error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove admin'
    });
  }
};

// Add group member
exports.addGroupMember = async (req, res) => {
  try {
    const { participantIds = [] } = req.body;
    const group = req.group;

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'participantIds must be a non-empty array'
      });
    }

    // Get current active member IDs
    const existingUserIds = new Set(
      group.participants
        .filter(p => p.isActive)
        .map(p => p.user.toString())
    );

    const addedUsers = [];
    const skippedUsers = [];

    for (const userId of participantIds) {
      if (existingUserIds.has(userId)) {
        skippedUsers.push(userId);
        continue;
      }

      group.participants.push({
        user: userId,
        role: 'member',
        joinedAt: new Date(),
        isActive: true
      });

      addedUsers.push(userId);
    }

    if (addedUsers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All users are already group members',
        skippedUsers
      });
    }

    await group.save();

    res.json({
      success: true,
      message: 'Members added successfully',
      addedCount: addedUsers.length,
      addedUsers,
      skippedUsers
    });
  } catch (err) {
    console.error('Add members error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to add members'
    });
  }
};


// Remove group member
exports.removeGroupMember = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const group = req.group;
    const requesterId = req.user.id;

    // Can't remove yourself
    if (targetUserId === requesterId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Use the leave group endpoint instead'
      });
    }

    const participant = group.participants.find(
      p => p.user.toString() === targetUserId && p.isActive
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'User not found in group'
      });
    }

    // Can't remove owner
    if (participant.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove group owner'
      });
    }

    // Remove the user
    participant.isActive = false;
    participant.leftAt = new Date();

    await group.save();

    res.json({
      success: true,
      message: 'User removed from group'
    });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove member'
    });
  }
};

// Leave group
exports.leaveGroup = async (req, res) => {
  try {
    const group = req.group;
    const userId = req.user.id;

    const participant = group.participants.find(
      p => p.user.toString() === userId && p.isActive
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    // Owner cannot leave group, must delete or transfer ownership
    if (participant.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Group owner cannot leave. Transfer ownership or delete the group.'
      });
    }

    // Mark as inactive
    participant.isActive = false;
    participant.leftAt = new Date();

    await group.save();

    res.json({
      success: true,
      message: 'You have left the group'
    });
  } catch (err) {
    console.error('Leave group error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to leave group'
    });
  }
};

// Update group settings
exports.updateGroupSettings = async (req, res) => {
  try {
    const { settings } = req.body;
    const group = req.group;

    if (settings) {
      group.settings = { ...group.settings, ...settings };
      await group.save();
    }

    res.json({
      success: true,
      message: 'Group settings updated',
      data: group.settings
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update group settings'
    });
  }
};

// Get group members
exports.getGroupMembers = async (req, res) => {
  try {
    const group = req.group;

    const populatedGroup = await Conversation.findById(group._id)
      .populate('participants.user', 'firstName lastName email role profilePicture department')
      .lean();

    const activeMembers = populatedGroup.participants.filter(p => p.isActive);

    res.json({
      success: true,
      data: {
        members: activeMembers,
        total: activeMembers.length,
        owner: activeMembers.find(p => p.role === 'owner'),
        admins: activeMembers.filter(p => p.role === 'admin')
      }
    });
  } catch (err) {
    console.error('Get group members error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get group members'
    });
  }
};

// Get added and non-added users of a group
exports.getGroupUsersSplit = async (req, res) => {
  try {
    const group = req.group;

    // 1️⃣ Active group member IDs
    const activeMemberIds = group.participants
      .filter(p => p.isActive)
      .map(p => p.user.toString());

    // 2️⃣ Fetch added users
    const addedUsers = await User.find({
      _id: { $in: activeMemberIds },
      isActive: true
    }).select('firstName lastName email role profilePicture department');

    // 3️⃣ Fetch non-added users
    const nonAddedUsers = await User.find({
      _id: { $nin: activeMemberIds },
      isActive: true
    }).select('firstName lastName email role profilePicture department');

    res.json({
      success: true,
      data: {
        addedUsers,
        nonAddedUsers,
        counts: {
          added: addedUsers.length,
          notAdded: nonAddedUsers.length
        }
      }
    });
  } catch (err) {
    console.error('Get group users split error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group users'
    });
  }
};
