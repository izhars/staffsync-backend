function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    throw new Error('Vectors must be non-null and same length');
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Euclidean distance (lower = more similar).
 */
function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

/**
 * L2 normalize a vector (important for consistent cosine scoring).
 */
function l2Normalize(vec) {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}

/**
 * Face match with a strict threshold.
 * Threshold guidance (cosine):
 *   0.60 → lenient (good lighting)
 *   0.75 → balanced
 *   0.88 → strict (recommended for HR punch)
 */
function verifyFaceMatch(liveEmbedding, storedEmbedding, threshold = 0.88) {
  const liveNorm = l2Normalize(liveEmbedding);
  const storedNorm = l2Normalize(storedEmbedding);

  const similarity = cosineSimilarity(liveNorm, storedNorm);
  const distance = euclideanDistance(liveNorm, storedNorm);

  return {
    matched: similarity >= threshold,
    similarity: parseFloat(similarity.toFixed(4)),
    distance: parseFloat(distance.toFixed(4)),
    threshold,
  };
}


async function verifyEmployeeFace(FaceEmbedding, employeeId, liveEmbedding, threshold = 0.75) {
  if (!Array.isArray(liveEmbedding) || liveEmbedding.length < 128) {
    return { ok: false, status: 400, reason: 'INVALID_EMBEDDING', message: 'Invalid face data.' };
  }

  const record = await FaceEmbedding.findOne({ employee: employeeId, isActive: true });
  if (!record) {
    return {
      ok: false,
      status: 404,
      reason: 'NOT_ENROLLED',
      message: 'Face not registered. Please register your face before punching in.',
    };
  }

  const result = verifyFaceMatch(liveEmbedding, record.embedding, threshold);
  if (!result.matched) {
    return {
      ok: false,
      status: 401,
      reason: 'FACE_MISMATCH',
      message: 'Face does not match your registered profile.',
      similarity: result.similarity,
      threshold: result.threshold,
    };
  }

  return { ok: true, similarity: result.similarity, threshold: result.threshold, model: record.model };
}

module.exports = {
  cosineSimilarity,
  euclideanDistance,
  l2Normalize,
  verifyFaceMatch,
  verifyEmployeeFace, // add to exports
};