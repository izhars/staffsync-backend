// middleware/upload.js
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const AppError = require('../utils/appError');

// --------------------
// Cloudinary Config
// --------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --------------------
// Upload Configs
// --------------------
const uploadConfigs = {
  profile: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: 'profile_pictures',
    resourceType: 'image'
  },

  badge: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    maxSize: 2 * 1024 * 1024, // 2MB
    folder: 'badges',
    resourceType: 'image'
  },

  expense: {
    extensions: ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.txt'],
    mimeTypes: [
      'image/jpeg', 'image/jpg', 'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    folder: 'expenses',
    resourceType: 'auto'
  },

  chat: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.mp4', '.mp3', '.mov', '.wav'],
    mimeTypes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'video/mp4', 'video/quicktime',
      'audio/mpeg', 'audio/wav'
    ],
    maxSize: 25 * 1024 * 1024, // 25MB
    folder: 'chat_attachments',
    resourceType: 'auto'
  },

  bulk: {
    extensions: ['.csv', '.json', '.xlsx', '.xls'],
    mimeTypes: [
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ],
    maxSize: 15 * 1024 * 1024, // 15MB
    folder: 'bulk_imports',
    resourceType: 'raw'
  },
  holiday: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
    mimeTypes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    folder: 'holiday_images',
    resourceType: 'image'
  },
  group: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: 'group_avatars',
    resourceType: 'image'
  },

  chatProfile: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 3 * 1024 * 1024, // 3MB
    folder: 'chat_profiles',
    resourceType: 'image'
  },

  messageAttachment: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.txt', '.mp3', '.mp4', '.mov', '.avi', '.zip', '.rar'],
    mimeTypes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'audio/mpeg', 'audio/wav',
      'video/mp4', 'video/quicktime', 'video/x-msvideo',
      'application/zip', 'application/x-rar-compressed'
    ],
    maxSize: 15 * 1024 * 1024, // 15MB
    folder: 'message_attachments',
    resourceType: 'auto'
  },
  rfid: {
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: 'rfid_scans',
    resourceType: 'image'
  }

};

// --------------------
// Multer Setup
// --------------------
const storage = multer.memoryStorage();

// General file filter (default)
const fileFilter = (req, file, cb) => {
  const uploadType = req.body.type || 'expense';
  const config = uploadConfigs[uploadType];

  console.log(`[UPLOAD] Incoming file: ${file.originalname}, type: ${file.mimetype}, uploadType: ${uploadType}`);

  if (!config) {
    console.log('[UPLOAD] Invalid upload type:', uploadType);
    return cb(new AppError('Invalid upload type', 400));
  }

  const fileExt = path.extname(file.originalname).toLowerCase();

  // Check file extension first
  if (!config.extensions.includes(fileExt)) {
    console.log('[UPLOAD] Invalid file extension:', fileExt);
    return cb(
      new AppError(
        `Invalid file type for ${uploadType}. Allowed: ${config.extensions.join(', ')}`,
        400
      )
    );
  }

  const allowedMimeTypes = [...config.mimeTypes, 'application/octet-stream'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    console.log('[UPLOAD] File accepted');
    cb(null, true);
  } else {
    console.log('[UPLOAD] Invalid MIME type:', file.mimetype);
    cb(
      new AppError(
        `Invalid file type for ${uploadType}. Allowed: ${config.extensions.join(', ')}`,
        400
      )
    );
  }
};

const uploadRfidImage = async (buffer, epc = 'unknown', options = {}) => {
  return uploadToCloudinary(buffer, 'rfid', {
    folder: `rfid_scans/${epc}`, // 👈 separate folder per EPC (chef’s kiss)
    resource_type: 'image',
    transformation: [
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};

// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // max cap, per-type enforced logically
  }
});

// --------------------
// Specialized Upload Functions
// --------------------

// 1. General upload function with options
const uploadToCloudinary = async (buffer, uploadType = 'expense', options = {}) => {
  console.log(`[CLOUDINARY] Uploading file, type: ${uploadType}`);
  const config = uploadConfigs[uploadType];

  if (!config) {
    throw new Error(`Invalid upload type: ${uploadType}`);
  }

  if (!Buffer.isBuffer(buffer)) {
    console.log('[CLOUDINARY] Invalid buffer');
    throw new Error('Invalid file buffer');
  }

  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: options.folder || config.folder,
      resource_type: options.resource_type || config.resourceType,
      ...options
    };

    // Add transformations for images
    if ((options.resource_type === 'image' || config.resourceType === 'image') && !options.transformation) {
      uploadOptions.transformation = [{ quality: 'auto', fetch_format: 'auto' }];
    }

    cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.log('[CLOUDINARY] Upload error:', error);
          return reject(error);
        }

        console.log('[CLOUDINARY] Upload successful:', result.secure_url);
        console.log('[CLOUDINARY] Stored in folder:', options.folder || config.folder);

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          resourceType: result.resource_type,
          originalFilename: result.original_filename
        });
      }
    ).end(buffer);
  });
};

// 2. Specialized Expense Upload
const uploadExpenseFile = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'expense', {
    folder: options.folder || 'expenses',
    resource_type: options.resource_type || 'auto',
    ...options
  });
};

// 3. Specialized Chat Upload
const uploadChatAttachment = async (buffer, fileType = 'auto', options = {}) => {
  // Determine resource type based on fileType
  let resourceType = 'auto';
  if (fileType) {
    if (fileType.startsWith('image/')) {
      resourceType = 'image';
    } else if (fileType.startsWith('video/')) {
      resourceType = 'video';
    } else if (fileType.startsWith('audio/')) {
      resourceType = 'video'; // Cloudinary uses 'video' for audio
    } else if (fileType.includes('pdf') || fileType.includes('document')) {
      resourceType = 'raw';
    }
  }

  return uploadToCloudinary(buffer, 'chat', {
    folder: options.folder || 'chat_attachments',
    resource_type: resourceType,
    ...options
  });
};

// 4. Base64 Upload Function
const uploadBase64ToCloudinary = async (base64String, options = {}) => {
  // Ensure we have a clean base64 string without data URL prefix
  let cleanBase64 = base64String;

  // Remove data URL prefix if present (e.g., "data:image/png;base64,")
  if (cleanBase64.includes('base64,')) {
    cleanBase64 = cleanBase64.split('base64,')[1];
  }

  // Ensure it's a valid base64 string
  if (!cleanBase64 || cleanBase64.trim() === '') {
    throw new Error('Invalid base64 data');
  }

  return new Promise((resolve, reject) => {
    const resourceType = options.resource_type || 'auto';
    const mimeType = resourceType === 'image' ? 'image/jpeg' :
      resourceType === 'video' ? 'video/mp4' :
        'application/octet-stream';

    cloudinary.uploader.upload(
      `data:${mimeType};base64,${cleanBase64}`,
      {
        folder: options.folder || 'uploads',
        resource_type: resourceType,
        transformation: resourceType === 'image' ? [{ quality: 'auto', fetch_format: 'auto' }] : [],
        ...options
      },
      (error, result) => {
        if (error) {
          console.log('[CLOUDINARY] Base64 upload error:', error);
          return reject(error);
        }
        console.log('[CLOUDINARY] Base64 upload successful:', result.secure_url);
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          resourceType: result.resource_type
        });
      }
    );
  });
};

// 5. Profile Picture Upload
const uploadProfilePicture = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'profile', {
    folder: options.folder || 'profile_pictures',
    resource_type: 'image',
    transformation: [
      { width: 500, height: 500, crop: 'fill' },
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};

// 6. Badge Image Upload
const uploadBadgeImage = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'badge', {
    folder: options.folder || 'badges',
    resource_type: 'image',
    transformation: [
      { width: 300, height: 300, crop: 'fill' },
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};

// 7. Bulk Import Upload
const uploadBulkFile = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'bulk', {
    folder: options.folder || 'bulk_imports',
    resource_type: 'raw',
    ...options
  });
};

// 8. Group Avatar Upload
const uploadGroupAvatar = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'group', {
    folder: options.folder || 'group_avatars',
    resource_type: 'image',
    transformation: [
      { width: 800, height: 800, crop: 'fill' },
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};

// 9. Chat Profile Picture Upload
const uploadChatProfile = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'chatProfile', {
    folder: options.folder || 'chat_profiles',
    resource_type: 'image',
    transformation: [
      { width: 500, height: 500, crop: 'fill' },
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};

// 10. Message Attachment Upload
const uploadMessageAttachment = async (buffer, fileType, options = {}) => {
  let resourceType = 'auto';
  if (fileType) {
    if (fileType.startsWith('image/')) {
      resourceType = 'image';
    } else if (fileType.startsWith('video/')) {
      resourceType = 'video';
    } else if (fileType.startsWith('audio/')) {
      resourceType = 'video';
    } else if (fileType.includes('pdf') || fileType.includes('document')) {
      resourceType = 'raw';
    }
  }

  return uploadToCloudinary(buffer, 'messageAttachment', {
    folder: options.folder || 'message_attachments',
    resource_type: resourceType,
    ...options
  });
};

// 11. Multi-file Upload
const uploadMultipleFiles = async (files, uploadType = 'expense', options = {}) => {
  const uploadPromises = files.map(file =>
    uploadToCloudinary(file.buffer, uploadType, {
      folder: options.folder,
      resource_type: options.resource_type,
      public_id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...options
    })
  );

  return Promise.all(uploadPromises);
};


const uploadHolidayImage = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'holiday', {
    folder: options.folder || 'holiday_images',
    resource_type: 'image',
    transformation: [
      { width: 1200, height: 800, crop: 'fill', gravity: 'auto' },
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};

// 13. Holiday Thumbnail Upload (for list views)
const uploadHolidayThumbnail = async (buffer, options = {}) => {
  return uploadToCloudinary(buffer, 'holiday', {
    folder: options.folder || 'holiday_thumbnails',
    resource_type: 'image',
    transformation: [
      { width: 400, height: 300, crop: 'fill', gravity: 'auto' },
      { quality: 'auto', fetch_format: 'auto' }
    ],
    ...options
  });
};


// --------------------
// Helper Functions
// --------------------

// Delete file from Cloudinary
const deleteFromCloudinary = async (publicId, options = {}) => {
  console.log('[CLOUDINARY] Deleting file:', publicId);
  try {
    const result = await cloudinary.uploader.destroy(publicId, options);
    console.log('[CLOUDINARY] Delete result:', result);
    return result;
  } catch (error) {
    console.error('[CLOUDINARY] Delete error:', error);
    throw error;
  }
};

// Delete multiple files
const deleteMultipleFromCloudinary = async (publicIds, options = {}) => {
  console.log('[CLOUDINARY] Deleting multiple files:', publicIds.length);
  try {
    const result = await cloudinary.api.delete_resources(publicIds, options);
    console.log('[CLOUDINARY] Multiple delete result:', result);
    return result;
  } catch (error) {
    console.error('[CLOUDINARY] Multiple delete error:', error);
    throw error;
  }
};

// Get Cloudinary resource info
const getCloudinaryResourceInfo = async (publicId, options = {}) => {
  try {
    const result = await cloudinary.api.resource(publicId, options);
    return result;
  } catch (error) {
    console.error('[CLOUDINARY] Get resource error:', error);
    throw error;
  }
};

// Generate image URL with transformations
const generateImageUrl = (publicId, transformations = []) => {
  const defaultTransformations = [{ quality: 'auto', fetch_format: 'auto' }];
  const allTransformations = [...defaultTransformations, ...transformations];

  return cloudinary.url(publicId, {
    transformation: allTransformations
  });
};

// --------------------
// Multer Instances for Different Upload Types
// --------------------

// Helper function to create file filters for specialized uploads
function createFileFilter(uploadType) {
  return (req, file, cb) => {
    const config = uploadConfigs[uploadType];

    console.log(`[UPLOAD ${uploadType.toUpperCase()}] File: ${file.originalname}, type: ${file.mimetype}`);

    if (!config) {
      return cb(new AppError(`Invalid upload type: ${uploadType}`, 400));
    }

    const fileExt = path.extname(file.originalname).toLowerCase();

    if (!config.extensions.includes(fileExt)) {
      console.log(`[UPLOAD] Invalid file extension for ${uploadType}:`, fileExt);
      return cb(
        new AppError(
          `Invalid file type for ${uploadType}. Allowed: ${config.extensions.join(', ')}`,
          400
        )
      );
    }

    const allowedMimeTypes = [...config.mimeTypes, 'application/octet-stream'];

    if (allowedMimeTypes.includes(file.mimetype)) {
      console.log(`[UPLOAD] ${uploadType} file accepted`);
      cb(null, true);
    } else {
      console.log(`[UPLOAD] Invalid MIME type for ${uploadType}:`, file.mimetype);
      cb(
        new AppError(
          `Invalid file type for ${uploadType}. Allowed: ${config.extensions.join(', ')}`,
          400
        )
      );
    }
  };
}

// Create specialized multer instances
const profileUpload = multer({
  storage,
  fileFilter: createFileFilter('profile'),
  limits: { fileSize: uploadConfigs.profile.maxSize }
});

const badgeUpload = multer({
  storage,
  fileFilter: createFileFilter('badge'),
  limits: { fileSize: uploadConfigs.badge.maxSize }
});

const chatUpload = multer({
  storage,
  fileFilter: createFileFilter('chat'),
  limits: { fileSize: uploadConfigs.chat.maxSize }
});

const expenseUpload = multer({
  storage,
  fileFilter: createFileFilter('expense'),
  limits: { fileSize: uploadConfigs.expense.maxSize }
});

const bulkUpload = multer({
  storage,
  fileFilter: createFileFilter('bulk'),
  limits: { fileSize: uploadConfigs.bulk.maxSize }
});

const groupUpload = multer({
  storage,
  fileFilter: createFileFilter('group'),
  limits: { fileSize: uploadConfigs.group.maxSize }
});

const chatProfileUpload = multer({
  storage,
  fileFilter: createFileFilter('chatProfile'),
  limits: { fileSize: uploadConfigs.chatProfile.maxSize }
});

const messageAttachmentUpload = multer({
  storage,
  fileFilter: createFileFilter('messageAttachment'),
  limits: { fileSize: uploadConfigs.messageAttachment.maxSize }
});

// Add after other multer instances
const holidayUpload = multer({
  storage,
  fileFilter: createFileFilter('holiday'),
  limits: { fileSize: uploadConfigs.holiday.maxSize }
});

// Single file upload for any type (dynamic based on type field)
const singleUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }
}).single('file');

// Multiple file upload for any type
const multipleUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }
}).array('files', 10); // Max 10 files

// Delete image from Cloudinary
const deleteRfidImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (err) {
    console.error('❌ Cloudinary delete error:', err.message);
    throw err;
  }
};

// --------------------
// Export
// --------------------
module.exports = {
  upload,
  profileUpload,
  badgeUpload,
  chatUpload,
  expenseUpload,
  bulkUpload,
  groupUpload,
  chatProfileUpload,
  messageAttachmentUpload,
  singleUpload,
  multipleUpload,
  uploadToCloudinary,
  uploadExpenseFile,
  uploadChatAttachment,
  uploadBase64ToCloudinary,
  uploadProfilePicture,
  uploadBadgeImage,
  uploadBulkFile,
  uploadGroupAvatar,
  uploadChatProfile,
  uploadMessageAttachment,
  uploadMultipleFiles,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary,
  getCloudinaryResourceInfo,
  generateImageUrl,
  uploadRfidImage,
  uploadConfigs,
  deleteRfidImage,
  cloudinary,
  holidayUpload,
  uploadHolidayImage,
  uploadHolidayThumbnail,
};