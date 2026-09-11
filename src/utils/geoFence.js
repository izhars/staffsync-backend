const GeoFenceLocation = require('../models/GeoFenceLocation');

// ─────────────────────────────────────────────────────────────────────────────
// Haversine Formula - distance between two coordinates in meters
// ─────────────────────────────────────────────────────────────────────────────
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isValidCoordinates = (lat, lon) => {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Emergency escape hatch (set in .env):
//   ALLOW_CHECKIN_WITHOUT_GEOFENCE=true
// Use ONLY for local dev / initial bootstrap. Never in production.
// ─────────────────────────────────────────────────────────────────────────────
const ALLOW_WITHOUT_GEOFENCE =
  String(process.env.ALLOW_CHECKIN_WITHOUT_GEOFENCE).toLowerCase() === 'true';

// ─────────────────────────────────────────────────────────────────────────────
// Main check
// ─────────────────────────────────────────────────────────────────────────────
const isWithinAnyGeoFence = async (userLat, userLon, userId = null, userDepartmentId = null) => {
  if (!isValidCoordinates(userLat, userLon)) {
    return {
      allowed: false,
      reason: 'INVALID_COORDINATES',
      message: 'Invalid coordinates provided',
      matchedLocation: null,
      nearestLocation: null,
      distance: null,
    };
  }

  const locations = await GeoFenceLocation.find({ isActive: true }).lean();

  // ── No active geo-fence configured ─────────────────────────────────────
  if (!locations || locations.length === 0) {
    if (ALLOW_WITHOUT_GEOFENCE) {
      console.warn(
        '[GEO-FENCE] ⚠️ No active locations. ALLOW_CHECKIN_WITHOUT_GEOFENCE=true → allowing.'
      );
      return {
        allowed: true,
        reason: 'NO_GEOFENCE_BOOTSTRAP_BYPASS',
        message: 'No geo-fence configured (bootstrap bypass enabled)',
        matchedLocation: null,
        nearestLocation: null,
        distance: null,
      };
    }

    console.error('[GEO-FENCE] ❌ No active locations configured. Blocking check-in.');
    return {
      allowed: false,
      reason: 'NO_GEOFENCE_CONFIGURED',
      message: 'No geo-fence locations configured. Contact HR/Admin.',
      matchedLocation: null,
      nearestLocation: null,
      distance: null,
    };
  }

  // ── Filter locations this employee can access ──────────────────────────
  const availableLocations = locations.filter((loc) => {
    const noDeptRestriction = !loc.allowedDepartments || loc.allowedDepartments.length === 0;
    const noEmpRestriction = !loc.allowedEmployees || loc.allowedEmployees.length === 0;
    if (noDeptRestriction && noEmpRestriction) return true;

    if (userId && loc.allowedEmployees?.some((id) => id.toString() === userId.toString())) {
      return true;
    }
    if (
      userDepartmentId &&
      loc.allowedDepartments?.some((id) => id.toString() === userDepartmentId.toString())
    ) {
      return true;
    }
    return false;
  });

  if (availableLocations.length === 0) {
    return {
      allowed: false,
      reason: 'NO_LOCATION_ASSIGNED',
      message: 'No geo-fence location assigned to you. Contact HR/Admin.',
      matchedLocation: null,
      nearestLocation: null,
      distance: null,
    };
  }

  // ── Compute distances ──────────────────────────────────────────────────
  const results = availableLocations.map((loc) => {
    const distance = calculateDistance(userLat, userLon, loc.latitude, loc.longitude);
    return {
      location: loc,
      distance: Math.round(distance),
      withinRadius: distance <= loc.radiusMeters,
    };
  });

  const matched = results.filter((r) => r.withinRadius);

  if (matched.length > 0) {
    matched.sort((a, b) => a.distance - b.distance);
    const best = matched[0];

    return {
      allowed: true,
      reason: 'WITHIN_FENCE',
      message: `✅ You are at "${best.location.name}" (${best.distance}m from center)`,
      matchedLocation: {
        id: best.location._id,
        name: best.location.name,
        type: best.location.type,
        address: best.location.address,
        distance: best.distance,
      },
      allMatches: matched.map((m) => ({ name: m.location.name, distance: m.distance })),
      nearestLocation: null,
      distance: best.distance,
    };
  }

  // ── No match — provide nearest for diagnostics ─────────────────────────
  results.sort((a, b) => a.distance - b.distance);
  const nearest = results[0];

  return {
    allowed: false,
    reason: 'OUTSIDE_FENCE',
    message: `❌ You are not within any allowed location.\nNearest: "${nearest.location.name}" is ${nearest.distance}m away (allowed: ${nearest.location.radiusMeters}m)`,
    matchedLocation: null,
    nearestLocation: {
      id: nearest.location._id,
      name: nearest.location.name,
      type: nearest.location.type,
      address: nearest.location.address,
      distance: nearest.distance,
      allowedRadius: nearest.location.radiusMeters,
    },
    distance: nearest.distance,
    allLocations: results.map((r) => ({
      name: r.location.name,
      distance: r.distance,
      allowedRadius: r.location.radiusMeters,
      withinRadius: r.withinRadius,
    })),
  };
};

module.exports = {
  calculateDistance,
  isValidCoordinates,
  isWithinAnyGeoFence,
};