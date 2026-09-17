// middleware/groupAuth.js
const Conversation = require('../models/Conversation');

/**
 * 🛡️ Group Authorization Middleware
 * Separate from main auth middleware for better organization.
 *
 * All permission methods assume:
 *   1. `auth.protect` has already run (req.user is set)
 *   2. `groupAuth.getGroup` has already run (req.group is set)
 */
class GroupAuth {
  /**
   * 🔍 Get Group from Params
   * Attaches group to request if it exists and is valid.
   */
  static async getGroup(req, res, next) {
    try {
      const { groupId } = req.params;

      if (!groupId) {
        return res.status(400).json({
          success: false,
          message: 'Group ID is required',
        });
      }

      const group = await Conversation.findOne({
        _id: groupId,
        type: 'group',
        isArchived: false,
      });

      if (!group) {
        return res.status(404).json({
          success: false,
          message: 'Group not found',
        });
      }

      req.group = group;
      next();
    } catch (err) {
      console.error('❌ Get group error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch group',
      });
    }
  }

  /**
   * 🔐 Shared helper: extract userId or short-circuit with 401.
   * Returns the userId string, or null if a response was already sent.
   */
  static _requireUser(req, res) {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
      return null;
    }
    return userId;
  }

  /**
   * 👑 Group Owner Only
   */
  static ownerOnly(req, res, next) {
    try {
      const userId = GroupAuth._requireUser(req, res);
      if (!userId) return;

      const group = req.group;
      const isOwner = group.participants.some(
        (p) =>
          p.user.toString() === userId &&
          p.role === 'owner' &&
          p.isActive
      );

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Only group owner can perform this action',
        });
      }

      next();
    } catch (err) {
      console.error('❌ Owner check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify ownership',
      });
    }
  }

  /**
   * 🛡️ Group Admin or Owner
   */
  static adminOrOwner(req, res, next) {
    try {
      const userId = GroupAuth._requireUser(req, res);
      if (!userId) return;

      const group = req.group;
      const isAdminOrOwner = group.participants.some(
        (p) =>
          p.user.toString() === userId &&
          p.isActive &&
          (p.role === 'admin' || p.role === 'owner')
      );

      if (!isAdminOrOwner) {
        return res.status(403).json({
          success: false,
          message: 'Only group admins or owner can perform this action',
        });
      }

      next();
    } catch (err) {
      console.error('❌ Admin/Owner check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify admin privileges',
      });
    }
  }

  /**
   * 👥 Group Member Only
   */
  static memberOnly(req, res, next) {
    try {
      const userId = GroupAuth._requireUser(req, res);
      if (!userId) return;

      const group = req.group;
      const isMember = group.participants.some(
        (p) => p.user.toString() === userId && p.isActive
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this group',
        });
      }

      next();
    } catch (err) {
      console.error('❌ Member check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify membership',
      });
    }
  }

  /**
   * 🚫 Cannot Target Owner
   * Prevents targeting the group owner for certain actions.
   */
  static cannotTargetOwner(req, res, next) {
    try {
      const group = req.group;
      const targetUserId = req.params.userId || req.body.userId;

      if (!targetUserId) {
        return next();
      }

      const isTargetOwner = group.participants.some(
        (p) =>
          p.user.toString() === targetUserId.toString() &&
          p.role === 'owner' &&
          p.isActive
      );

      if (isTargetOwner) {
        return res.status(400).json({
          success: false,
          message: 'Cannot perform this action on group owner',
        });
      }

      next();
    } catch (err) {
      console.error('❌ Target owner check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify target user',
      });
    }
  }

  /**
   * 📊 Check Group Size Limit
   * Counts only ACTIVE participants so inactive/removed members
   * don't wrongly block new additions.
   */
  static checkGroupSize(req, res, next) {
    try {
      const group = req.group;

      const activeCount = group.participants.filter((p) => p.isActive).length;
      const max = group.settings?.maxParticipants ?? Infinity;

      if (activeCount >= max) {
        return res.status(400).json({
          success: false,
          message: `Group has reached maximum participants (${max})`,
        });
      }

      next();
    } catch (err) {
      console.error('❌ Group size check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to check group size',
      });
    }
  }

  /**
   * 🔐 Public Group Access
   * Allows access if group is public OR user is an active member.
   */
  static publicOrMember(req, res, next) {
    try {
      const group = req.group;
      const userId = req.user?.id;

      // Public group → anyone authenticated can read
      if (group.settings?.isPublic) {
        return next();
      }

      // Private group → must be active member
      if (userId) {
        const isMember = group.participants.some(
          (p) => p.user.toString() === userId && p.isActive
        );
        if (isMember) {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: 'This group is private. You must be a member to access it.',
      });
    } catch (err) {
      console.error('❌ Public/member check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify access permissions',
      });
    }
  }

  /**
   * 📝 Can Send Messages
   * Checks if user can send messages (not muted, media allowed, etc.).
   */
  static canSendMessages(req, res, next) {
    try {
      const userId = GroupAuth._requireUser(req, res);
      if (!userId) return;

      const group = req.group;
      const participant = group.participants.find(
        (p) => p.user.toString() === userId && p.isActive
      );

      if (!participant) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this group',
        });
      }

      // Mute check
      const mute = participant.notificationSettings?.mute;
      const muteUntil = participant.notificationSettings?.muteUntil;
      if (mute && muteUntil && new Date() < new Date(muteUntil)) {
        return res.status(403).json({
          success: false,
          message: 'You are muted from sending messages in this group',
        });
      }

      // Media attachment check
      if (group.settings && group.settings.allowMedia === false && req.body?.attachment) {
        return res.status(403).json({
          success: false,
          message: 'Media attachments are not allowed in this group',
        });
      }

      next();
    } catch (err) {
      console.error('❌ Send message check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify message permissions',
      });
    }
  }

  /**
   * 🔧 Can Modify Settings
   * Only owners and admins can modify group settings.
   */
  static canModifySettings(req, res, next) {
    try {
      const userId = GroupAuth._requireUser(req, res);
      if (!userId) return;

      const group = req.group;
      const isAdminOrOwner = group.participants.some(
        (p) =>
          p.user.toString() === userId &&
          p.isActive &&
          (p.role === 'admin' || p.role === 'owner')
      );

      if (!isAdminOrOwner) {
        return res.status(403).json({
          success: false,
          message: 'Only admins or owner can modify group settings',
        });
      }

      next();
    } catch (err) {
      console.error('❌ Modify settings check error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to verify settings permissions',
      });
    }
  }
}

module.exports = GroupAuth;