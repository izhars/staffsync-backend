const GeoFenceLocation = require('../models/GeoFenceLocation');
const User = require('../models/User');

// @desc    Create new geo-fence location
// @route   POST /api/geo-fence/locations
// @access  Private (HR, superadmin)
exports.createLocation = async (req, res) => {
  try {
    const {
      name,
      type,
      shape = 'circle',       // NEW
      address,
      latitude,
      longitude,
      radiusMeters,
      polylinePoints,          // NEW
      corridorWidthMeters,     // NEW
      allowedDepartments,
      allowedEmployees,
      remarks,
    } = req.body;

    // Duplicate name
    const existing = await GeoFenceLocation.findOne({ name: name?.trim() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A location with this name already exists',
      });
    }

    // Shape-specific validation
    if (shape === 'circle') {
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude are required for circle geo-fence',
        });
      }
    } else if (shape === 'polyline') {
      if (!Array.isArray(polylinePoints) || polylinePoints.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'At least 2 polyline points are required for polyline geo-fence',
        });
      }
      for (const pt of polylinePoints) {
        if (
          pt.latitude === undefined ||
          pt.longitude === undefined ||
          isNaN(parseFloat(pt.latitude)) ||
          isNaN(parseFloat(pt.longitude))
        ) {
          return res.status(400).json({
            success: false,
            message: 'Each polyline point must have valid latitude and longitude',
          });
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'shape must be either "circle" or "polyline"',
      });
    }

    const payload = {
      name,
      type: type || (shape === 'polyline' ? 'highway' : 'office'),
      shape,
      address,
      allowedDepartments: allowedDepartments || [],
      allowedEmployees: allowedEmployees || [],
      remarks,
      createdBy: req.user.id,
    };

    if (shape === 'circle') {
      payload.latitude = parseFloat(latitude);
      payload.longitude = parseFloat(longitude);
      payload.radiusMeters = radiusMeters || 100;
    } else {
      payload.polylinePoints = polylinePoints.map((p) => ({
        latitude: parseFloat(p.latitude),
        longitude: parseFloat(p.longitude),
        label: p.label,
      }));
      payload.corridorWidthMeters = corridorWidthMeters || 100;
    }

    const location = await GeoFenceLocation.create(payload);

    res.status(201).json({
      success: true,
      message: `Location "${location.name}" added successfully`,
      location,
    });
  } catch (error) {
    console.error('Create location error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const location = await GeoFenceLocation.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    const fieldsToUpdate = [
      'name', 'type', 'shape', 'address',
      'latitude', 'longitude', 'radiusMeters',
      'polylinePoints', 'corridorWidthMeters',
      'allowedDepartments', 'allowedEmployees',
      'remarks', 'isActive',
    ];

    fieldsToUpdate.forEach((field) => {
      if (req.body[field] !== undefined) {
        location[field] = req.body[field];
      }
    });

    // Sanitize polyline points if provided
    if (location.shape === 'polyline' && Array.isArray(location.polylinePoints)) {
      location.polylinePoints = location.polylinePoints.map((p) => ({
        latitude: parseFloat(p.latitude),
        longitude: parseFloat(p.longitude),
        label: p.label,
      }));
    }

    await location.save();

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      location,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all geo-fence locations
// @route   GET /api/geo-fence/locations
// @access  Private (HR, superadmin)
exports.getAllLocations = async (req, res) => {
  try {
    const { isActive, type, search } = req.query;

    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (type) query.type = type;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
      ];
    }

    const locations = await GeoFenceLocation.find(query)
      .populate('allowedDepartments', 'name')
      .populate('allowedEmployees', 'firstName lastName employeeId')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: locations.length,
      locations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single location
// @route   GET /api/geo-fence/locations/:id
// @access  Private (HR, superadmin)
exports.getLocationById = async (req, res) => {
  try {
    const location = await GeoFenceLocation.findById(req.params.id)
      .populate('allowedDepartments', 'name')
      .populate('allowedEmployees', 'firstName lastName employeeId');

    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    res.status(200).json({ success: true, location });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete location
// @route   DELETE /api/geo-fence/locations/:id
// @access  Private (HR, superadmin)
exports.deleteLocation = async (req, res) => {
  try {
    const location = await GeoFenceLocation.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    await location.deleteOne();

    res.status(200).json({
      success: true,
      message: `Location "${location.name}" deleted successfully`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Toggle location active status
// @route   PATCH /api/geo-fence/locations/:id/toggle
// @access  Private (HR, superadmin)
exports.toggleLocationStatus = async (req, res) => {
  try {
    const location = await GeoFenceLocation.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    location.isActive = !location.isActive;
    await location.save();

    res.status(200).json({
      success: true,
      message: `Location "${location.name}" ${location.isActive ? 'activated' : 'deactivated'}`,
      isActive: location.isActive,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get locations available to logged-in employee
// @route   GET /api/geo-fence/my-locations
// @access  Private
exports.getMyLocations = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('department');
    const userId = req.user.id;
    const deptId = user?.department;

    const locations = await GeoFenceLocation.find({ isActive: true })
      .select('name type shape address latitude longitude radiusMeters polylinePoints corridorWidthMeters')
      .lean();

    const available = locations.filter((loc) => {
      const noDept = !loc.allowedDepartments || loc.allowedDepartments.length === 0;
      const noEmp = !loc.allowedEmployees || loc.allowedEmployees.length === 0;
      if (noDept && noEmp) return true;
      if (loc.allowedEmployees?.some((id) => id.toString() === userId.toString())) return true;
      if (deptId && loc.allowedDepartments?.some((id) => id.toString() === deptId.toString())) return true;
      return false;
    });

    res.status(200).json({
      success: true,
      count: available.length,
      locations: available,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Check if coordinates are within any allowed location (preview)
// @route   POST /api/geo-fence/check
// @access  Private
exports.checkLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const { isWithinAnyGeoFence } = require('../utils/geoFence');

    const user = await User.findById(req.user.id).select('department');
    const result = await isWithinAnyGeoFence(
      parseFloat(latitude),
      parseFloat(longitude),
      req.user.id,
      user?.department
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};