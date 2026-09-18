// utils/geoFence.js
const GeoFenceLocation = require('../models/GeoFenceLocation');

const EARTH_RADIUS_M = 6371000;

/** Haversine distance in meters between two coords */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Distance (meters) from point P to the polyline defined by points[].
 * For each segment, project P onto the segment (in a locally-flat
 * approximation) and clamp to segment endpoints.
 */
function distanceToPolylineMeters(pLat, pLon, points) {
  if (!points || points.length === 0) return Infinity;
  if (points.length === 1) {
    return haversineMeters(pLat, pLon, points[0].latitude, points[0].longitude);
  }

  // Local equirectangular projection around P
  const toRad = (d) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(pLat));

  const project = (lat, lon) => ({
    x: toRad(lon - pLon) * cosLat * EARTH_RADIUS_M,
    y: toRad(lat - pLat) * EARTH_RADIUS_M,
  });

  let minDist = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const A = project(points[i].latitude, points[i].longitude);
    const B = project(points[i + 1].latitude, points[i + 1].longitude);

    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const segLenSq = dx * dx + dy * dy;

    let t = 0;
    if (segLenSq > 0) {
      // P is at origin (0,0) in this projection
      t = -(A.x * dx + A.y * dy) / segLenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const closestX = A.x + t * dx;
    const closestY = A.y + t * dy;
    const dist = Math.sqrt(closestX * closestX + closestY * closestY);

    if (dist < minDist) minDist = dist;
  }

  return minDist;
}

/**
 * Main entry — checks a coordinate against all active geo-fences
 * the user has access to.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} userId
 * @param {string} departmentId
 * @param {number} gpsAccuracyMeters - device-reported accuracy radius,
 *        added to the threshold so normal GPS jitter near a boundary
 *        isn't wrongly rejected. Caller should cap this (e.g. 50m max)
 *        before passing it in.
 *
 * Returns:
 *   { allowed, reason, matchedLocation, nearestLocation, allLocations, message }
 */
async function isWithinAnyGeoFence(latitude, longitude, userId, departmentId, gpsAccuracyMeters = 0) {
  const locations = await GeoFenceLocation.find({ isActive: true }).lean();

  // Filter by department/employee access
  const accessible = locations.filter((loc) => {
    const noDept = !loc.allowedDepartments || loc.allowedDepartments.length === 0;
    const noEmp = !loc.allowedEmployees || loc.allowedEmployees.length === 0;
    if (noDept && noEmp) return true;
    if (loc.allowedEmployees?.some((id) => id.toString() === userId.toString())) return true;
    if (departmentId && loc.allowedDepartments?.some((id) => id.toString() === departmentId.toString()))
      return true;
    return false;
  });

  if (accessible.length === 0) {
    return {
      allowed: false,
      reason: 'NO_LOCATIONS_CONFIGURED',
      message: 'No geo-fence locations configured for you. Contact HR.',
      matchedLocation: null,
      nearestLocation: null,
      allLocations: [],
    };
  }

  const safeAccuracy = Math.max(0, Math.min(gpsAccuracyMeters || 0, 50));

  const evaluated = accessible.map((loc) => {
    if (loc.shape === 'polyline') {
      const dist = distanceToPolylineMeters(latitude, longitude, loc.polylinePoints);
      // Distance is measured from the centerline, so the allowed
      // threshold is HALF the corridor width, not the full width.
      const threshold = (loc.corridorWidthMeters || 100) / 2 + safeAccuracy;
      return {
        ...loc,
        distance: Math.round(dist),
        allowed: dist <= threshold,
        threshold: Math.round(threshold),
        shape: 'polyline',
      };
    }
    // circle
    const dist = haversineMeters(latitude, longitude, loc.latitude, loc.longitude);
    const threshold = (loc.radiusMeters || 100) + safeAccuracy;
    return {
      ...loc,
      distance: Math.round(dist),
      allowed: dist <= threshold,
      threshold: Math.round(threshold),
      shape: 'circle',
    };
  });

  const matched = evaluated.find((l) => l.allowed);

  if (matched) {
    return {
      allowed: true,
      reason: 'WITHIN_FENCE',
      matchedLocation: {
        id: matched._id,
        name: matched.name,
        type: matched.type,
        shape: matched.shape,
        distance: matched.distance,
      },
      nearestLocation: null,
      allLocations: evaluated.map((l) => ({
        id: l._id,
        name: l.name,
        shape: l.shape,
        distance: l.distance,
        allowed: l.allowed,
      })),
      message: `Within ${matched.name} (${matched.distance}m)`,
    };
  }

  // Not allowed — find nearest for the error message
  const nearest = evaluated.reduce((a, b) => (a.distance < b.distance ? a : b));
  return {
    allowed: false,
    reason: 'OUTSIDE_ALL_FENCES',
    message: `You are ${nearest.distance}m away from nearest location "${nearest.name}" (allowed: ${nearest.threshold}m)`,
    matchedLocation: null,
    nearestLocation: {
      id: nearest._id,
      name: nearest.name,
      shape: nearest.shape,
      distance: nearest.distance,
      threshold: nearest.threshold,
    },
    allLocations: evaluated.map((l) => ({
      id: l._id,
      name: l.name,
      shape: l.shape,
      distance: l.distance,
      allowed: l.allowed,
    })),
  };
}

module.exports = {
  isWithinAnyGeoFence,
  haversineMeters,
  distanceToPolylineMeters,
};