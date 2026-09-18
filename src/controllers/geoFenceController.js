const GeoFenceLocation = require('../models/GeoFenceLocation');
const User = require('../models/User');
const Department = require('../models/Department');
const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Coerce an array of values (string IDs or populated objects) into
 *  unique, valid ObjectId strings. Returns [] on anything unusable. */
function normalizeIdArray(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const raw =
      typeof item === 'string'
        ? item
        : item && (item._id || item.id)
        ? String(item._id || item.id)
        : null;
    if (!raw) continue;
    if (!mongoose.Types.ObjectId.isValid(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** Verify every ID exists in the given collection. Returns
 *  { ok: true } or { ok: false, missing: [ids] }. */
async function validateIdsExist(Model, ids) {
  if (!ids.length) return { ok: true };
  const found = await Model.find({ _id: { $in: ids } }).select('_id').lean();
  const foundSet = new Set(found.map((d) => String(d._id)));
  const missing = ids.filter((id) => !foundSet.has(String(id)));
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Validate shape-specific fields. Returns null if OK, else an error message. */
function validateShapePayload({ shape, latitude, longitude, polylinePoints }) {
  if (shape === 'circle') {
    if (latitude === undefined || longitude === undefined) {
      return 'Latitude and longitude are required for circle geo-fence';
    }
    if (isNaN(parseFloat(latitude)) || isNaN(parseFloat(longitude))) {
      return 'Latitude and longitude must be valid numbers';
    }
  } else if (shape === 'polyline') {
    if (!Array.isArray(polylinePoints) || polylinePoints.length < 2) {
      return 'At least 2 polyline points are required for polyline geo-fence';
    }
    for (const pt of polylinePoints) {
      if (
        pt.latitude === undefined ||
        pt.longitude === undefined ||
        isNaN(parseFloat(pt.latitude)) ||
        isNaN(parseFloat(pt.longitude))
      ) {
        return 'Each polyline point must have valid latitude and longitude';
      }
    }
  } else {
    return 'shape must be either "circle" or "polyline"';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

// @desc    Create new geo-fence location
// @route   POST /api/geo-fence/locations
// @access  Private (HR, superadmin)
exports.createLocation = async (req, res) => {
  try {
    const {
      name,
      type,
      shape = 'circle',
      address,
      latitude,
      longitude,
      radiusMeters,
      polylinePoints,
      waypoints,
      corridorWidthMeters,
      allowedDepartments,
      allowedEmployees,
      remarks,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!address || !String(address).trim()) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }

    // Duplicate name
    const existing = await GeoFenceLocation.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A location with this name already exists',
      });
    }

    // Shape validation
    const shapeErr = validateShapePayload({ shape, latitude, longitude, polylinePoints });
    if (shapeErr) {
      return res.status(400).json({ success: false, message: shapeErr });
    }

    // Normalize + validate assignees
    const deptIds = normalizeIdArray(allowedDepartments);
    const empIds  = normalizeIdArray(allowedEmployees);

    const [deptCheck, empCheck] = await Promise.all([
      validateIdsExist(Department, deptIds),
      validateIdsExist(User, empIds),
    ]);
    if (!deptCheck.ok) {
      return res.status(400).json({
        success: false,
        message: `Unknown department id(s): ${deptCheck.missing.join(', ')}`,
      });
    }
    if (!empCheck.ok) {
      return res.status(400).json({
        success: false,
        message: `Unknown employee id(s): ${empCheck.missing.join(', ')}`,
      });
    }

    const payload = {
      name: name.trim(),
      type: type || (shape === 'polyline' ? 'highway' : 'office'),
      shape,
      address: address.trim(),
      allowedDepartments: deptIds,
      allowedEmployees: empIds,
      remarks,
      createdBy: req.user.id,
    };

    if (shape === 'circle') {
      payload.latitude = parseFloat(latitude);
      payload.longitude = parseFloat(longitude);
      payload.radiusMeters = Number(radiusMeters) || 100;
    } else {
      payload.polylinePoints = polylinePoints.map((p) => ({
        latitude: parseFloat(p.latitude),
        longitude: parseFloat(p.longitude),
        label: p.label,
      }));
      payload.corridorWidthMeters = Number(corridorWidthMeters) || 100;
      if (Array.isArray(waypoints) && waypoints.length) {
        payload.waypoints = waypoints.map((p) => ({
          latitude: parseFloat(p.latitude),
          longitude: parseFloat(p.longitude),
          label: p.label,
        }));
      }
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

// @desc    Update geo-fence location
// @route   PUT /api/geo-fence/locations/:id
// @access  Private (HR, superadmin)
exports.updateLocation = async (req, res) => {
  try {
    const location = await GeoFenceLocation.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    // If name changed, check uniqueness
    if (req.body.name !== undefined && req.body.name.trim() !== location.name) {
      const dup = await GeoFenceLocation.findOne({
        name: req.body.name.trim(),
        _id: { $ne: location._id },
      });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: 'A location with this name already exists',
        });
      }
    }

    // Compute prospective shape inputs for validation
    const nextShape = req.body.shape ?? location.shape;
    const nextLat = req.body.latitude ?? location.latitude;
    const nextLng = req.body.longitude ?? location.longitude;
    const nextPoly = req.body.polylinePoints ?? location.polylinePoints;

    const shapeErr = validateShapePayload({
      shape: nextShape,
      latitude: nextLat,
      longitude: nextLng,
      polylinePoints: nextPoly,
    });
    if (shapeErr) {
      return res.status(400).json({ success: false, message: shapeErr });
    }

    // Normalize + validate assignees if provided
    if (req.body.allowedDepartments !== undefined) {
      const deptIds = normalizeIdArray(req.body.allowedDepartments);
      const check = await validateIdsExist(Department, deptIds);
      if (!check.ok) {
        return res.status(400).json({
          success: false,
          message: `Unknown department id(s): ${check.missing.join(', ')}`,
        });
      }
      location.allowedDepartments = deptIds;
    }

    if (req.body.allowedEmployees !== undefined) {
      const empIds = normalizeIdArray(req.body.allowedEmployees);
      const check = await validateIdsExist(User, empIds);
      if (!check.ok) {
        return res.status(400).json({
          success: false,
          message: `Unknown employee id(s): ${check.missing.join(', ')}`,
        });
      }
      location.allowedEmployees = empIds;
    }

    // Scalar/primitive fields
    const simpleFields = [
      'name', 'type', 'shape', 'address',
      'remarks', 'isActive',
    ];
    simpleFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        location[field] =
          field === 'name' || field === 'address'
            ? String(req.body[field]).trim()
            : req.body[field];
      }
    });

    // Numeric fields
    if (req.body.latitude !== undefined) location.latitude = parseFloat(req.body.latitude);
    if (req.body.longitude !== undefined) location.longitude = parseFloat(req.body.longitude);
    if (req.body.radiusMeters !== undefined) location.radiusMeters = Number(req.body.radiusMeters);
    if (req.body.corridorWidthMeters !== undefined)
      location.corridorWidthMeters = Number(req.body.corridorWidthMeters);

    // Polyline / waypoints
    if (req.body.polylinePoints !== undefined) {
      location.polylinePoints = req.body.polylinePoints.map((p) => ({
        latitude: parseFloat(p.latitude),
        longitude: parseFloat(p.longitude),
        label: p.label,
      }));
    }
    if (req.body.waypoints !== undefined && Array.isArray(req.body.waypoints)) {
      location.waypoints = req.body.waypoints.map((p) => ({
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
    console.error('Update location error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all geo-fence locations
// @route   GET /api/geo-fence/locations
// @access  Private (HR, superadmin, manager+)
exports.getAllLocations = async (req, res) => {
  try {
    const { isActive, type, search, shape } = req.query;

    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (type) query.type = type;
    if (shape) query.shape = shape;
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
// @access  Private (manager+)
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
      const noEmp  = !loc.allowedEmployees  || loc.allowedEmployees.length === 0;
      if (noDept && noEmp) return true;
      if (loc.allowedEmployees?.some((id) => id.toString() === userId.toString())) return true;
      if (deptId && loc.allowedDepartments?.some((id) => id.toString() === deptId.toString()))
        return true;
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

// @desc    Check if coordinates are within any allowed location (punch-in)
// @route   POST /api/geo-fence/check
// @access  Private
exports.checkLocation = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'latitude and longitude are required',
      });
    }

    const { isWithinAnyGeoFence } = require('../utils/geoFence');

    const user = await User.findById(req.user.id).select('department');
    const result = await isWithinAnyGeoFence(
      parseFloat(latitude),
      parseFloat(longitude),
      req.user.id,
      user?.department,
      accuracy ? parseFloat(accuracy) : 0
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────
// NEW: Assignable users / departments
// ─────────────────────────────────────────────────────────────

// @desc    List employees + departments that can be assigned to a geo-fence
// @route   GET /api/geo-fence/assignable-users
// @access  Private (HR, superadmin)
exports.getAssignableUsers = async (req, res) => {
  try {
    const { search } = req.query;

    const empQuery = { isActive: { $ne: false } };
    if (search) {
      empQuery.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName:  { $regex: search, $options: 'i' } },
        { employeeId:{ $regex: search, $options: 'i' } },
        { email:     { $regex: search, $options: 'i' } },
      ];
    }

    const [employees, departments] = await Promise.all([
      User.find(empQuery)
        .select('firstName lastName employeeId email department')
        .populate('department', 'name')
        .sort({ firstName: 1 })
        .limit(1000)
        .lean(),
      Department.find({})
        .select('name')
        .sort({ name: 1 })
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      employees: employees.map((e) => ({
        _id: e._id,
        firstName: e.firstName,
        lastName: e.lastName,
        employeeId: e.employeeId,
        email: e.email,
        department: e.department
          ? { _id: e.department._id, name: e.department.name }
          : null,
      })),
      departments: departments.map((d) => ({ _id: d._id, name: d.name })),
    });
  } catch (error) {
    console.error('getAssignableUsers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Bulk-update assignees on a single location
// @route   PATCH /api/geo-fence/locations/:id/assignees
// @access  Private (HR, superadmin)
exports.updateAssignees = async (req, res) => {
  try {
    const { allowedDepartments, allowedEmployees } = req.body;

    const location = await GeoFenceLocation.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ success: false, message: 'Location not found' });
    }

    if (allowedDepartments !== undefined) {
      const deptIds = normalizeIdArray(allowedDepartments);
      const check = await validateIdsExist(Department, deptIds);
      if (!check.ok) {
        return res.status(400).json({
          success: false,
          message: `Unknown department id(s): ${check.missing.join(', ')}`,
        });
      }
      location.allowedDepartments = deptIds;
    }

    if (allowedEmployees !== undefined) {
      const empIds = normalizeIdArray(allowedEmployees);
      const check = await validateIdsExist(User, empIds);
      if (!check.ok) {
        return res.status(400).json({
          success: false,
          message: `Unknown employee id(s): ${check.missing.join(', ')}`,
        });
      }
      location.allowedEmployees = empIds;
    }

    await location.save();

    const populated = await GeoFenceLocation.findById(location._id)
      .populate('allowedDepartments', 'name')
      .populate('allowedEmployees', 'firstName lastName employeeId');

    res.status(200).json({
      success: true,
      message: 'Assignees updated successfully',
      location: populated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};