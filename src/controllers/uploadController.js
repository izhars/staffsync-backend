const cloudinary = require('cloudinary').v2;
const {
  uploadToCloudinary,
  deleteFromCloudinary,
  uploadGroupAvatar,
  uploadProfilePicture,
  uploadChatProfile
} = require('../middleware/upload');
const Message = require('../models/Message');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const AppError = require('../utils/appError');

// ============================
// GROUP AVATAR UPLOAD
// ============================
exports.uploadGroupAvatar = async (req, res) => {
  try {
    console.log('📤 [Group Avatar Upload] Starting...');

    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Check file size and type
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds 5MB limit'
      });
    }

    // Check if groupId is provided (for existing group update)
    const { groupId } = req.body;
    let oldPublicId = null;

    // If updating existing group, get old avatar for deletion
    if (groupId) {
      console.log(`🔍 Updating avatar for group: ${groupId}`);
      const group = await Conversation.findById(groupId);

      if (!group) {
        return res.status(404).json({
          success: false,
          message: 'Group not found'
        });
      }

      // Check if user has permission (admin or owner)
      const userRole = group.getUserRole(req.user.id);
      if (!['admin', 'owner'].includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: 'Only admins or owner can update group avatar'
        });
      }

      // Store old public ID for cleanup
      if (group.avatarPublicId) {
        oldPublicId = group.avatarPublicId;
      }
    }

    // Upload to Cloudinary
    const uploadResult = await uploadGroupAvatar(req.file.buffer, {
      folder: `group_avatars/${req.user.id}`,
      public_id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    console.log('✅ Group avatar uploaded:', uploadResult.url);

    // Delete old avatar if exists
    if (oldPublicId) {
      try {
        await deleteFromCloudinary(oldPublicId);
        console.log('🗑️ Old avatar deleted:', oldPublicId);
      } catch (deleteError) {
        console.warn('⚠️ Failed to delete old avatar:', deleteError);
      }
    }

    res.json({
      success: true,
      message: 'Group avatar uploaded successfully',
      data: {
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
        width: uploadResult.width,
        height: uploadResult.height,
        resourceType: uploadResult.resourceType
      }
    });

  } catch (error) {
    console.error('❌ Group avatar upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload group avatar'
    });
  }
};

// ============================
// PROFILE PICTURE UPLOAD
// ============================
exports.uploadProfilePicture = async (req, res) => {
  try {
    console.log('📤 [Profile Picture Upload] Starting...');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const userId = req.body.userId || req.user.id;

    // Check permission
    if (userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile picture'
      });
    }

    // Get user and old avatar info
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldPublicId = user.profilePicturePublicId;

    // Upload new profile picture
    const uploadResult = await uploadProfilePicture(req.file.buffer, {
      folder: `profile_pictures/${userId}`,
      public_id: `profile_${userId}_${Date.now()}`
    });

    // Delete old profile picture
    if (oldPublicId) {
      try {
        await deleteFromCloudinary(oldPublicId);
        console.log('🗑️ Old profile picture deleted');
      } catch (deleteError) {
        console.warn('⚠️ Failed to delete old profile:', deleteError);
      }
    }

    // Update user in database
    user.profilePicture = uploadResult.url;
    user.profilePicturePublicId = uploadResult.publicId;
    await user.save();

    console.log('✅ Profile picture updated for user:', userId);

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      data: {
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        userId: user._id,
        fullName: user.fullName
      }
    });

  } catch (error) {
    console.error('❌ Profile picture upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload profile picture'
    });
  }
};

// ============================
// CHAT PROFILE UPLOAD
// ============================
exports.uploadChatProfile = async (req, res) => {
  try {
    console.log('📤 [Chat Profile Upload] Starting...');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldPublicId = user.chatProfilePicturePublicId;

    // Upload chat profile picture
    const uploadResult = await uploadChatProfile(req.file.buffer, {
      folder: `chat_profiles/${userId}`,
      public_id: `chat_profile_${userId}_${Date.now()}`
    });

    // Delete old chat profile
    if (oldPublicId) {
      try {
        await deleteFromCloudinary(oldPublicId);
      } catch (deleteError) {
        console.warn('Failed to delete old chat profile:', deleteError);
      }
    }

    // Update user
    user.chatProfilePicture = uploadResult.url;
    user.chatProfilePicturePublicId = uploadResult.publicId;
    await user.save();

    console.log('✅ Chat profile updated for user:', userId);

    res.json({
      success: true,
      message: 'Chat profile picture updated successfully',
      data: {
        url: uploadResult.url,
        publicId: uploadResult.publicId
      }
    });

  } catch (error) {
    console.error('❌ Chat profile upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload chat profile'
    });
  }
};

// ============================
// EXISTING FUNCTIONS (keep as is)
// ============================

// Upload single file
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { type, messageId, userId } = req.body;

    // Choose upload type from config
    const uploadType = type === 'profile' ? 'profile' : 'chat';

    // Upload to Cloudinary using buffer from memory storage
    const cloudinaryResult = await uploadToCloudinary(
      req.file.buffer,
      uploadType,
      {
        folder: type === 'profile' ? 'profiles' : 'chat_attachments',
        resource_type: 'auto',
      }
    );

    // Update chat message attachment
    if (type === 'chat' && messageId) {
      const message = await Message.findById(messageId);
      if (message) {
        message.attachment = {
          type: req.file.mimetype.startsWith('image/') ? 'image' : 'file',
          url: cloudinaryResult.url,
          filename: req.file.originalname,
          size: req.file.size,
          publicId: cloudinaryResult.publicId,
          mimeType: req.file.mimetype,
          uploadedAt: new Date(),
        };
        await message.save();
      }
    }

    // Update user profile picture
    if (type === 'profile' && userId) {
      const user = await User.findById(userId);
      if (user) {
        // Delete old profile picture if exists
        if (user.profilePicture?.publicId) {
          try {
            await deleteFromCloudinary(user.profilePicture.publicId);
          } catch (err) {
            console.error('❌ Failed to delete old profile picture:', err);
          }
        }

        user.profilePicture = {
          url: cloudinaryResult.url,
          publicId: cloudinaryResult.publicId,
          uploadedAt: new Date(),
        };
        await user.save();
      }
    }

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: {
        url: cloudinaryResult.url,
        publicId: cloudinaryResult.publicId,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        type: req.file.mimetype.startsWith('image/') ? 'image' : 'file',
        dimensions: cloudinaryResult.width && cloudinaryResult.height
          ? { width: cloudinaryResult.width, height: cloudinaryResult.height }
          : null,
      },
    });
  } catch (error) {
    console.error('❌ Upload error occurred:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'File upload failed',
    });
  }
};


// Upload multiple files
exports.uploadMultipleFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadResults = [];

    for (const file of req.files) {
      try {
        // Determine the upload type based on the request body,
        // falling back to 'chat' (chat_attachments config).
        const uploadType = req.body.type || 'chat';

        const cloudinaryResult = await uploadToCloudinary(
          file.buffer,
          uploadType, // 👈 string, not an object
          {
            folder: 'chat_attachments',
            resource_type: 'auto',
            public_id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          }
        );

        uploadResults.push({
          success: true,
          file: {
            url: cloudinaryResult.url,
            publicId: cloudinaryResult.publicId,
            originalName: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            type: file.mimetype.startsWith('image/') ? 'image' : 'file',
            dimensions:
              cloudinaryResult.width && cloudinaryResult.height
                ? { width: cloudinaryResult.width, height: cloudinaryResult.height }
                : null,
          },
        });
      } catch (fileError) {
        console.error(`Error uploading ${file.originalname}:`, fileError);
        uploadResults.push({
          success: false,
          originalName: file.originalname,
          error: fileError.message,
        });
      }
    }

    const successCount = uploadResults.filter((r) => r.success).length;

    res.json({
      success: true,
      message: `${successCount} file${successCount === 1 ? '' : 's'} uploaded successfully`,
      results: uploadResults,
    });
  } catch (error) {
    console.error('❌ Multiple upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'File upload failed',
    });
  }
};

// Delete a file
exports.deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;
    const result = await deleteFromCloudinary(publicId);

    res.json({
      success: result.result === 'ok',
      message: result.result === 'ok' ? 'File deleted successfully' : 'File deletion failed',
    });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ success: false, error: error.message || 'File deletion failed' });
  }
};

// Get signed URL for direct Cloudinary uploads
exports.getSignedUploadUrl = async (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const params = { timestamp, folder: 'chat_attachments' };
    const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);

    res.json({
      signature,
      timestamp,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      folder: 'chat_attachments',
    });
  } catch (error) {
    console.error('❌ Sign upload error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate upload signature' });
  }
};