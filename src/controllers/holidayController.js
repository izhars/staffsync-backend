const Holiday = require('../models/Holiday');
const mongoose = require('mongoose');
const csv = require('csv-parser');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const {
  uploadHolidayImage,
  deleteFromCloudinary
} = require('../middleware/upload');

// Add one or multiple holidays
exports.addHoliday = async (req, res) => {
  try {
    let holidays = req.body;
    if (!Array.isArray(holidays)) holidays = [holidays];

    const createdHolidays = [];
    const errors = [];

    const session = await Holiday.startSession();
    session.startTransaction();

    try {
      for (const h of holidays) {
        const {
          name, date, description,
          type = 'Festival',
          category = 'Mandatory',
          maxAllowed = null,
          applicableTo = ['all'],
          image = null // ✅ NEW: Accept image data
        } = h;

        // Validate required fields
        if (!name || !date) {
          errors.push(`Holiday "${name || 'unknown'}": Name and date are required`);
          continue;
        }

        // Validate category
        if (!['Mandatory', 'Restricted'].includes(category)) {
          errors.push(`Holiday "${name}": Category must be 'Mandatory' or 'Restricted'`);
          continue;
        }

        // Validate maxAllowed for restricted holidays
        if (category === 'Restricted' && maxAllowed !== null) {
          if (!Number.isInteger(maxAllowed) || maxAllowed < 1) {
            errors.push(`Holiday "${name}": maxAllowed must be a positive integer`);
            continue;
          }
        }

        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
          errors.push(`Holiday "${name}": Invalid date format`);
          continue;
        }

        // Check if holiday already exists on this date
        const existing = await Holiday.findOne({
          date: parsedDate
        }).session(session);

        if (existing) {
          errors.push(`Holiday "${name}" already exists on ${parsedDate.toDateString()}`);
          continue;
        }

        const holiday = await Holiday.create([{
          name,
          date: parsedDate,
          description,
          type,
          category,
          maxAllowed: category === 'Restricted' ? maxAllowed : null,
          applicableTo,
          image, // ✅ NEW
          createdBy: req.user?._id
        }], { session });

        createdHolidays.push(holiday[0]);
      }

      await session.commitTransaction();

      if (errors.length > 0) {
        return res.status(207).json({
          message: 'Some holidays were created with errors',
          created: createdHolidays,
          errors
        });
      }

      res.status(201).json({
        message: 'Holidays created successfully',
        data: createdHolidays
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Add holiday error:', error);
    res.status(500).json({ message: 'Failed to create holidays', error: error.message });
  }
};

// ✅ NEW: Upload holiday image
exports.uploadHolidayImage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const holiday = await Holiday.findById(id);
    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    // Delete old image if exists
    if (holiday.image && holiday.image.publicId) {
      try {
        await deleteFromCloudinary(holiday.image.publicId);
        console.log('🗑️ Old holiday image deleted:', holiday.image.publicId);
      } catch (err) {
        console.error('Failed to delete old image:', err.message);
        // Continue even if delete fails
      }
    }

    // Upload new image
    const uploadResult = await uploadHolidayImage(req.file.buffer, {
      folder: `holiday_images/${id}`
    });

    // Update holiday with image data
    holiday.image = {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
      width: uploadResult.width,
      height: uploadResult.height,
      originalFilename: uploadResult.originalFilename,
      uploadedAt: new Date()
    };

    await holiday.save();

    res.json({
      success: true,
      message: 'Holiday image uploaded successfully',
      data: {
        holiday: holiday,
        image: holiday.image
      }
    });

  } catch (error) {
    console.error('Upload holiday image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload holiday image',
      error: error.message
    });
  }
};

// ✅ NEW: Delete holiday image
exports.deleteHolidayImage = async (req, res) => {
  try {
    const { id } = req.params;

    const holiday = await Holiday.findById(id);
    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    if (!holiday.image || !holiday.image.publicId) {
      return res.status(400).json({ message: 'Holiday has no image to delete' });
    }

    // Delete from Cloudinary
    await deleteFromCloudinary(holiday.image.publicId);

    // Remove image data from holiday
    holiday.image = {
      url: null,
      publicId: null,
      format: null,
      bytes: null,
      width: null,
      height: null,
      originalFilename: null,
      uploadedAt: null
    };

    await holiday.save();

    res.json({
      success: true,
      message: 'Holiday image deleted successfully',
      data: holiday
    });

  } catch (error) {
    console.error('Delete holiday image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete holiday image',
      error: error.message
    });
  }
};

// Update holiday
exports.updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // ✅ Validate category if provided
    if (updateData.category &&
      !['Mandatory', 'Restricted'].includes(updateData.category)) {
      return res.status(400).json({
        message: "Category must be 'Mandatory' or 'Restricted'"
      });
    }

    // ✅ If changing to Mandatory, clear maxAllowed
    if (updateData.category === 'Mandatory') {
      updateData.maxAllowed = null;
    }

    // ✅ Validate maxAllowed for restricted
    if (updateData.category === 'Restricted' && updateData.maxAllowed !== null) {
      if (!Number.isInteger(updateData.maxAllowed) || updateData.maxAllowed < 1) {
        return res.status(400).json({
          message: 'maxAllowed must be a positive integer for Restricted holidays'
        });
      }
    }

    if (updateData.date) {
      const parsedDate = new Date(updateData.date);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      updateData.date = parsedDate;

      const existing = await Holiday.findOne({
        date: updateData.date,
        _id: { $ne: id }
      });

      if (existing) {
        return res.status(400).json({
          message: `Holiday already exists on ${updateData.date.toDateString()}`
        });
      }
    }

    const holiday = await Holiday.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    res.json({
      message: 'Holiday updated successfully',
      data: holiday
    });
  } catch (error) {
    console.error('Update holiday error:', error);
    res.status(500).json({ message: 'Failed to update holiday', error: error.message });
  }
};

// ✅ NEW: Update holiday image (replace)
exports.updateHolidayImage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const holiday = await Holiday.findById(id);
    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    // Delete old image if exists
    if (holiday.image && holiday.image.publicId) {
      try {
        await deleteFromCloudinary(holiday.image.publicId);
      } catch (err) {
        console.error('Failed to delete old image:', err.message);
      }
    }

    // Upload new image
    const uploadResult = await uploadHolidayImage(req.file.buffer, {
      folder: `holiday_images/${id}`
    });

    holiday.image = {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
      width: uploadResult.width,
      height: uploadResult.height,
      originalFilename: uploadResult.originalFilename,
      uploadedAt: new Date()
    };

    await holiday.save();

    res.json({
      success: true,
      message: 'Holiday image updated successfully',
      data: {
        holiday: holiday,
        image: holiday.image
      }
    });

  } catch (error) {
    console.error('Update holiday image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update holiday image',
      error: error.message
    });
  }
};

// Get all holidays with filtering and pagination
exports.getHolidays = async (req, res) => {
  try {
    const { year, month, type, category, isActive, search } = req.query; // ✅ added category
    const filter = {};

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true' || isActive === '1';
    }

    if (year) {
      const startYear = new Date(parseInt(year), 0, 1);
      const endYear = new Date(parseInt(year) + 1, 0, 1);
      filter.date = { $gte: startYear, $lt: endYear };
    }

    if (month && year) {
      const startMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endMonth = new Date(parseInt(year), parseInt(month), 1);
      filter.date = { ...filter.date, $gte: startMonth, $lt: endMonth };
    }

    if (type) filter.type = type;

    // ✅ NEW: Category filter
    if (category) {
      filter.category = category;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    console.log('Holiday filter:', filter);

    const holidays = await Holiday.find(filter)
      .sort({ date: 1 })
      .select('-__v');

    res.json({
      success: true,
      count: holidays.length,
      data: holidays,
      filters: { year, month, type, category, search, isActive }
    });
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch holidays',
      error: error.message
    });
  }
};

// Get holidays for a specific year
exports.getHolidaysByYear = async (req, res) => {
  try {
    const { year } = req.params;
    const { type, month } = req.query;

    if (!year || isNaN(parseInt(year))) {
      return res.status(400).json({ message: 'Valid year is required' });
    }

    const startDate = new Date(parseInt(year), 0, 1);
    const endDate = new Date(parseInt(year) + 1, 0, 1);

    let filter = {
      date: { $gte: startDate, $lt: endDate },
      isActive: true
    };

    if (type) filter.type = type;
    if (month) {
      filter.date = {
        ...filter.date,
        $gte: new Date(parseInt(year), parseInt(month) - 1, 1),
        $lte: new Date(parseInt(year), parseInt(month), 0, 23, 59, 59)
      };
    }

    const holidays = await Holiday
      .find(filter)
      .sort({ date: 1 })
      .select('-__v');

    res.json({
      year: parseInt(year),
      count: holidays.length,
      data: holidays
    });
  } catch (error) {
    console.error('Get holidays by year error:', error);
    res.status(500).json({ message: 'Failed to fetch holidays', error: error.message });
  }
};

// Get upcoming holidays (next 30 days)
exports.getUpcomingHolidays = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const holidays = await Holiday.find({
      date: { $gte: today, $lte: thirtyDaysFromNow },
      isActive: true
    })
      .sort({ date: 1 })
      .select('-__v');

    res.json({
      period: {
        from: today.toISOString().split('T')[0],
        to: thirtyDaysFromNow.toISOString().split('T')[0]
      },
      count: holidays.length,
      data: holidays
    });
  } catch (error) {
    console.error('Get upcoming holidays error:', error);
    res.status(500).json({ message: 'Failed to fetch upcoming holidays', error: error.message });
  }
};

// Get holidays by type
exports.getHolidaysByType = async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ['National', 'Festival', 'Regional', 'Religious'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        message: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const holidays = await Holiday.find({
      type,
      isActive: true
    })
      .sort({ date: 1 })
      .select('-__v');

    res.json({
      type,
      count: holidays.length,
      data: holidays
    });
  } catch (error) {
    console.error('Get holidays by type error:', error);
    res.status(500).json({ message: 'Failed to fetch holidays', error: error.message });
  }
};

// Get single holiday by ID
exports.getHolidayById = async (req, res) => {
  try {
    const holiday = await Holiday.findById(req.params.id);

    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    res.json(holiday);
  } catch (error) {
    console.error('Get holiday by ID error:', error);
    res.status(500).json({ message: 'Failed to fetch holiday', error: error.message });
  }
};

// Update holiday
exports.deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const holiday = await Holiday.findById(id);
    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    // Delete image from Cloudinary if exists
    if (holiday.image && holiday.image.publicId) {
      try {
        await deleteFromCloudinary(holiday.image.publicId);
        console.log('🗑️ Holiday image deleted:', holiday.image.publicId);
      } catch (err) {
        console.error('Failed to delete holiday image:', err.message);
        // Continue with soft delete even if image deletion fails
      }
    }

    // Soft delete
    holiday.isActive = false;
    holiday.deletedAt = new Date();
    await holiday.save();

    res.json({
      message: 'Holiday soft-deleted successfully',
      data: holiday
    });
  } catch (error) {
    console.error('Delete holiday error:', error);
    res.status(500).json({ message: 'Failed to delete holiday', error: error.message });
  }
};


// Delete holiday (soft delete)
exports.deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const holiday = await Holiday.findByIdAndUpdate(
      id,
      {
        isActive: false,
        deletedAt: new Date()
      },
      { new: true }
    );

    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    res.json({
      message: 'Holiday soft-deleted successfully',
      data: holiday
    });
  } catch (error) {
    console.error('Delete holiday error:', error);
    res.status(500).json({ message: 'Failed to delete holiday', error: error.message });
  }
};

// Permanent delete holiday
exports.permanentDeleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const holiday = await Holiday.findById(id);
    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    // Delete image from Cloudinary if exists
    if (holiday.image && holiday.image.publicId) {
      try {
        await deleteFromCloudinary(holiday.image.publicId);
        console.log('🗑️ Holiday image permanently deleted:', holiday.image.publicId);
      } catch (err) {
        console.error('Failed to delete holiday image:', err.message);
      }
    }

    await Holiday.findByIdAndDelete(id);

    res.json({
      message: 'Holiday permanently deleted successfully',
      data: { id: holiday._id }
    });
  } catch (error) {
    console.error('Permanent delete holiday error:', error);
    res.status(500).json({ message: 'Failed to permanently delete holiday', error: error.message });
  }
};


// Bulk import holidays from CSV/JSON file
exports.bulkImportHolidays = async (req, res) => {
  try {
    console.log('📥 Bulk import started');

    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    console.log('📄 File received:', req.file.originalname, 'Type:', req.file.mimetype);

    const fileBuffer = req.file.buffer;
    const fileType = req.file.mimetype;

    const results = [];

    if (fileType === 'text/csv' || fileType === 'application/vnd.ms-excel') {
      console.log('🔄 Processing CSV file');

      const stream = require('stream');
      const csv = require('csv-parser');

      await new Promise((resolve, reject) => {
        const readable = stream.Readable();
        readable.push(fileBuffer);
        readable.push(null);

        readable
          .pipe(csv())
          .on('data', (data) => {
            const holidayData = {
              name: data.name?.trim(),
              date: new Date(data.date),
              description: data.description?.trim() || '',
              type: data.type?.trim() || 'Festival',
              category: data.category?.trim() || 'Mandatory',
              maxAllowed: data.maxAllowed ? parseInt(data.maxAllowed) : null,
              applicableTo: data.applicableTo
                ? data.applicableTo.split(',').map(s => s.trim())
                : ['all'],
              // ✅ NEW: Image URL from CSV (optional)
              imageUrl: data.imageUrl?.trim() || null
            };

            if (holidayData.name && !isNaN(holidayData.date.getTime())) {
              results.push(holidayData);
            } else {
              console.log('⚠️ Invalid row skipped:', data);
            }
          })
          .on('end', () => {
            console.log('✅ CSV parsing completed, valid rows:', results.length);
            resolve();
          })
          .on('error', (err) => {
            console.log('❌ CSV parsing error:', err);
            reject(err);
          });
      });

    } else if (fileType === 'application/json') {
      console.log('🔄 Processing JSON file');

      try {
        const jsonData = JSON.parse(fileBuffer.toString('utf-8'));
        if (Array.isArray(jsonData)) {
          jsonData.forEach(item => {
            const holidayData = {
              name: item.name?.trim(),
              date: new Date(item.date),
              description: item.description?.trim() || '',
              type: item.type?.trim() || 'Festival',
              category: item.category?.trim() || 'Mandatory',
              maxAllowed: item.maxAllowed || null,
              applicableTo: item.applicableTo || ['all'],
              // ✅ NEW: Image URL from JSON (optional)
              imageUrl: item.imageUrl?.trim() || null
            };
            if (holidayData.name && !isNaN(holidayData.date.getTime())) {
              results.push(holidayData);
            } else {
              console.log('⚠️ Invalid JSON row skipped:', item);
            }
          });
          console.log('✅ JSON parsing completed, valid rows:', results.length);
        }
      } catch (err) {
        console.log('❌ JSON parsing error:', err);
        return res.status(400).json({ message: 'Invalid JSON format' });
      }
    } else {
      console.log('❌ Unsupported file type:', fileType);
      return res.status(400).json({ message: 'Unsupported file type for bulk import' });
    }

    if (results.length === 0) {
      console.log('⚠️ No valid holidays found in file');
      return res.status(400).json({ message: 'No valid holidays found in file' });
    }

    const createdHolidays = [];
    const errors = [];

    for (const holidayData of results) {
      try {
        const existing = await Holiday.findOne({ date: holidayData.date });
        if (existing) {
          const msg = `Holiday already exists on ${holidayData.date.toDateString()}`;
          console.log('⚠️', msg);
          errors.push(msg);
          continue;
        }

        // ✅ NEW: Handle image URL if provided
        const holidayPayload = {
          name: holidayData.name,
          date: holidayData.date,
          description: holidayData.description,
          type: holidayData.type,
          category: holidayData.category,
          maxAllowed: holidayData.maxAllowed,
          applicableTo: holidayData.applicableTo
        };

        // If imageUrl provided, store it as external image reference
        if (holidayData.imageUrl) {
          holidayPayload.image = {
            url: holidayData.imageUrl,
            publicId: null, // External URL, no Cloudinary public ID
            format: holidayData.imageUrl.split('.').pop() || null,
            uploadedAt: new Date()
          };
        }

        const holiday = await Holiday.create(holidayPayload);
        console.log('✅ Holiday created:', holiday.name, holiday.date.toDateString());
        createdHolidays.push(holiday);
      } catch (err) {
        const msg = `Error creating "${holidayData.name}": ${err.message}`;
        console.log('❌', msg);
        errors.push(msg);
      }
    }

    console.log('📊 Bulk import completed:', createdHolidays.length, 'imported,', errors.length, 'failed');

    return res.status(201).json({
      message: 'Bulk import completed',
      imported: createdHolidays.length,
      errors: errors.length,
      data: createdHolidays,
      failed: errors
    });

  } catch (error) {
    console.error('🔥 Bulk import error:', error);
    return res.status(500).json({ message: 'Failed to import holidays', error: error.message });
  }
};


// Export holidays as CSV
exports.exportHolidays = async (req, res) => {
  try {
    const { format = 'csv', year } = req.query;

    let filter = { isActive: true };
    if (year) {
      const startDate = new Date(parseInt(year), 0, 1);
      const endDate = new Date(parseInt(year) + 1, 0, 1);
      filter.date = { $gte: startDate, $lt: endDate };
    }

    const holidays = await Holiday.find(filter).sort({ date: 1 });

    if (format === 'csv') {
      const csvWriter = createCsvWriter({
        path: 'holidays_export.csv',
        header: [
          { id: 'name', title: 'Name' },
          { id: 'date', title: 'Date' },
          { id: 'description', title: 'Description' },
          { id: 'type', title: 'Type' },
          { id: 'createdAt', title: 'Created At' },
          { id: 'updatedAt', title: 'Updated At' }
        ]
      });

      const records = holidays.map(holiday => ({
        name: holiday.name,
        date: holiday.date.toISOString().split('T')[0],
        description: holiday.description || '',
        type: holiday.type,
        createdAt: holiday.createdAt.toISOString().split('T')[0],
        updatedAt: holiday.updatedAt.toISOString().split('T')[0]
      }));

      await csvWriter.writeRecords(records);

      res.download('holidays_export.csv', `holidays_${year || 'all'}.csv`, (err) => {
        if (err) {
          fs.unlinkSync('holidays_export.csv');
        }
      });
    } else {
      // JSON export
      res.json({
        exportedAt: new Date().toISOString(),
        count: holidays.length,
        data: holidays
      });
    }
  } catch (error) {
    console.error('Export holidays error:', error);
    res.status(500).json({ message: 'Failed to export holidays', error: error.message });
  }
};

// ✅ NEW: Get holidays by category (Mandatory / Restricted)
exports.getHolidaysByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const { year } = req.query;

    const validCategories = ['Mandatory', 'Restricted'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        message: `Invalid category. Must be one of: ${validCategories.join(', ')}`
      });
    }

    const filter = { category, isActive: true };

    if (year) {
      const startDate = new Date(parseInt(year), 0, 1);
      const endDate = new Date(parseInt(year) + 1, 0, 1);
      filter.date = { $gte: startDate, $lt: endDate };
    }

    const holidays = await Holiday.find(filter)
      .sort({ date: 1 })
      .select('-__v');

    res.json({
      success: true,
      category,
      year: year || 'All',
      count: holidays.length,
      data: holidays
    });
  } catch (error) {
    console.error('Get holidays by category error:', error);
    res.status(500).json({
      message: 'Failed to fetch holidays by category',
      error: error.message
    });
  }
};

// ✅ NEW: Get restricted holiday summary
exports.getRestrictedHolidaySummary = async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;

    const startDate = new Date(parseInt(year), 0, 1);
    const endDate = new Date(parseInt(year) + 1, 0, 1);

    const restrictedHolidays = await Holiday.find({
      category: 'Restricted',
      isActive: true,
      date: { $gte: startDate, $lt: endDate }
    }).sort({ date: 1 }).select('-__v');

    const mandatoryHolidays = await Holiday.find({
      category: 'Mandatory',
      isActive: true,
      date: { $gte: startDate, $lt: endDate }
    }).sort({ date: 1 }).select('-__v');

    res.json({
      success: true,
      year: parseInt(year),
      summary: {
        totalMandatory: mandatoryHolidays.length,
        totalRestricted: restrictedHolidays.length,
        // Max selectable restricted (highest maxAllowed among restricted)
        maxSelectable: restrictedHolidays.reduce(
          (max, h) => Math.max(max, h.maxAllowed || 0), 0
        )
      },
      mandatory: mandatoryHolidays,
      restricted: restrictedHolidays
    });
  } catch (error) {
    console.error('Get restricted holiday summary error:', error);
    res.status(500).json({
      message: 'Failed to fetch restricted holiday summary',
      error: error.message
    });
  }
};

// Get holiday statistics
exports.getHolidayStats = async (req, res) => {
  try {
    const { year } = req.query;

    let matchStage = { isActive: true };
    if (year) {
      const startDate = new Date(parseInt(year), 0, 1);
      const endDate = new Date(parseInt(year) + 1, 0, 1);
      matchStage.date = { $gte: startDate, $lt: endDate };
    }

    // ✅ Stats by type
    const typeStats = await Holiday.aggregate([
      { $match: matchStage },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $project: { _id: 0, type: '$_id', count: 1 } }
    ]);

    // ✅ NEW: Stats by category
    const categoryStats = await Holiday.aggregate([
      { $match: matchStage },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $project: { _id: 0, category: '$_id', count: 1 } }
    ]);

    const total = await Holiday.countDocuments(matchStage);

    res.json({
      year: year || 'All',
      totalHolidays: total,
      byCategory: categoryStats,   // ✅ NEW
      byType: typeStats,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get holiday stats error:', error);
    res.status(500).json({ message: 'Failed to fetch statistics', error: error.message });
  }
};



// ✅ NEW: Get holiday image
exports.getHolidayImage = async (req, res) => {
  try {
    const { id } = req.params;

    const holiday = await Holiday.findById(id).select('image name');
    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    if (!holiday.image || !holiday.image.url) {
      return res.status(404).json({ message: 'Holiday has no image' });
    }

    res.json({
      success: true,
      data: {
        holidayId: holiday._id,
        holidayName: holiday.name,
        image: holiday.image
      }
    });
  } catch (error) {
    console.error('Get holiday image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch holiday image',
      error: error.message
    });
  }
};