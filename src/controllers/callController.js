const { v4: uuidv4 } = require('uuid');
const { sendNotification, sendCallNotification } = require('../firebase/notificationService');
const Call = require('../models/Call');
const User = require('../models/User');

/**
 * Start a new call
 */
async function startCall(req, res) {
  try {
    const callerId = req.user.id;
    const { receiverId: calleeId, type = 'video' } = req.body;

    if (!calleeId) {
      return res.status(400).json({ error: 'receiverId is required' });
    }

    if (calleeId === callerId) {
      return res.status(400).json({ error: 'Cannot call yourself' });
    }

    if (!['audio', 'video'].includes(type)) {
      return res.status(400).json({ error: 'Invalid call type' });
    }

    const callId = uuidv4();
    const roomId = uuidv4();

    const existingCall = await Call.findOne({
      $or: [
        { callerId, calleeId, status: { $in: ['ringing', 'accepted'] } },
        { callerId: calleeId, calleeId: callerId, status: { $in: ['ringing', 'accepted'] } }
      ]
    });

    if (existingCall) {
      return res.status(400).json({ error: 'Call already in progress' });
    }

    const call = await Call.create({
      callId,
      roomId,
      callerId,
      calleeId,
      type,
      status: 'ringing',
    });

    const caller = await User.findById(callerId).select('firstName lastName');
    const callerName = caller?.fullName || 'Unknown';

    const payload = {
      title: `Incoming ${type === 'audio' ? 'Audio' : 'Video'} Call`,
      body: `${callerName} is calling you`,
      data: {
        type: 'incoming_call',
        callId,
        roomId,
        callerId,
        callerName: callerName,
        callType: type,
        timestamp: Date.now().toString()
      }
    };

    sendNotification(calleeId, payload)
      .then(r => console.log('🔔 Notification sent:', r))
      .catch(err => console.error('⚠️ Notification failed:', err));

    res.json({
      success: true,
      callId,
      roomId,
      type
    });
  } catch (err) {
    console.error('🔥 [startCall] ERROR:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Accept a call
 */
async function acceptCall(req, res) {
  try {
    const { callId } = req.body;
    const userId = req.user.id;

    if (!callId) {
      return res.status(400).json({ error: 'callId is required' });
    }

    const call = await Call.findOne({ callId });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (call.calleeId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to accept this call' });
    }

    if (call.status !== 'ringing') {
      return res.status(400).json({
        error: `Cannot accept call in '${call.status}' state`
      });
    }

    const callee = await User.findById(userId).select('firstName lastName');
    const calleeName = callee?.fullName || 'Unknown';

    call.status = 'accepted';
    await call.save();

    // Only notify the caller (the other party)
    const payload = {
      title: 'Call Accepted',
      body: `${calleeName} accepted your call`,
      data: {
        type: 'call_accepted',
        callId: call.callId,
        roomId: call.roomId,
        calleeId: userId,
        calleeName: calleeName,
        timestamp: Date.now().toString()
      }
    };

    sendNotification(call.callerId, payload)
      .then(r => console.log('🔔 [acceptCall] Notification sent:', r))
      .catch(err => console.error('❌ [acceptCall] Notification failed:', err));

    return res.json({
      success: true,
      message: 'Call accepted',
      call: {
        _id: call._id,
        callId: call.callId,
        roomId: call.roomId,
        callerId: call.callerId,
        calleeId: call.calleeId,
        status: call.status
      }
    });

  } catch (err) {
    console.error('🔥 [acceptCall] ERROR:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Decline a call - FIXED: Only notify other party
 */
// In your callController.js, update the declineCall function:
async function declineCall(req, res) {
  try {
    const userId = req.user.id;
    const { callId, reason = 'user_declined' } = req.body;

    const call = await Call.findOne({ callId });
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    const isCaller = call.callerId.toString() === userId;
    const isCallee = call.calleeId.toString() === userId;

    if (!isCaller && !isCallee) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized'
      });
    }

    if (['ended', 'declined'].includes(call.status)) {
      return res.status(400).json({
        success: false,
        error: `Call already ${call.status}`
      });
    }

    const isMissedCall = call.status === 'ringing' && reason === 'timeout';
    call.status = isMissedCall ? 'missed' : 'declined';
    call.endedAt = new Date();
    if (isMissedCall) call.duration = 0;

    await call.save();

    // Determine target user (the OTHER party only)
    const targetUserId = isCaller ? call.calleeId.toString() : call.callerId.toString();
    
    // Use the new sendCallNotification function
    const notificationType = isMissedCall ? 'call_missed' : 'call_declined';
    
    await sendCallNotification({
      callerId: isCaller ? call.callerId : call.calleeId,
      receiverId: targetUserId,
      callId,
      roomId: call.roomId,
      callType: call.type || 'audio',
      notificationType: notificationType,
      actionBy: userId, // Who performed the action
      reason,
    });

    res.json({
      success: true,
      message: `Call ${call.status}`,
      call: {
        _id: call._id,
        callId: call.callId,
        roomId: call.roomId,
        status: call.status,
        declinedBy: userId,
        reason,
        endedAt: call.endedAt,
      }
    });

  } catch (err) {
    console.error('🔥 [declineCall] ERROR:', err);
    console.error('🔥 [declineCall] Stack:', err.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * End a call - FIXED: Only notify other party
 */
async function endCall(req, res) {
  try {
    const userId = req.user.id;
    const { callId } = req.body;

    if (!callId) return res.status(400).json({ error: 'callId is required' });

    const call = await Call.findOne({ callId });
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const isParticipant = [call.callerId.toString(), call.calleeId.toString()].includes(userId);
    if (!isParticipant) return res.status(403).json({ error: 'Not authorized' });

    if (call.status === 'ended')
      return res.status(400).json({ error: 'Call already ended' });

    call.status = 'ended';
    call.endedAt = new Date();
    call.duration = Math.floor((call.endedAt - call.createdAt) / 1000);
    await call.save();
    
    const user = await User.findById(userId).select('firstName lastName');
    const userName = user?.fullName || 'Unknown';

    // Determine the OTHER party only
    const targetUserId = call.callerId.toString() === userId
      ? call.calleeId.toString()
      : call.callerId.toString();

    const payload = {
      title: 'Call Ended',
      body: `${userName} ended the call`,
      data: {
        type: 'call_ended',
        callId: call.callId,
        roomId: call.roomId,
        endedBy: userId, // Who ended the call
        timestamp: Date.now().toString(),
        duration: call.duration.toString(),
      },
    };

    // Send notification only to OTHER party (not to self)
    sendNotification(targetUserId, payload)
      .then(result => console.log('🔔 [endCall] Notification sent to other party:', result))
      .catch(err => console.error('⚠️ [endCall] Notification failed:', err));

    res.json({
      success: true,
      message: 'Call ended',
      call: {
        _id: call._id,
        callId: call.callId,
        roomId: call.roomId,
        status: call.status,
        endedAt: call.endedAt,
        duration: call.duration,
      }
    });

  } catch (err) {
    console.error('🔥 [endCall] ERROR:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get a call by ID
 */
async function getCallById(req, res) {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const call = await Call.findOne({ callId })
      .populate('callerId', 'firstName lastName profilePicture')
      .populate('calleeId', 'firstName lastName profilePicture');

    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });

    const isParticipant = [call.callerId?._id?.toString(), call.calleeId?._id?.toString()].includes(userId);
    if (!isParticipant) return res.status(403).json({ success: false, error: 'Not authorized' });

    const callerName = call.callerId ? `${call.callerId.firstName} ${call.callerId.lastName}`.trim() : 'Unknown';
    const calleeName = call.calleeId ? `${call.calleeId.firstName} ${call.calleeId.lastName}`.trim() : 'Unknown';
    const callerImage = call.callerId?.profilePicture || '';
    const calleeImage = call.calleeId?.profilePicture || '';

    const endedAt = call.endedAt || (call.status === 'ended' ? call.updatedAt : null);
    const duration = endedAt ? Math.floor((endedAt - call.createdAt) / 1000) : null;

    res.json({
      success: true,
      call: {
        _id: call._id,
        callId: call.callId,
        roomId: call.roomId,
        callerId: call.callerId?._id,
        callerName,
        callerImage,
        receiverId: call.calleeId?._id,
        receiverName: calleeName,
        receiverImage: calleeImage,
        status: call.status,
        startedAt: call.createdAt,
        endedAt,
        type: call.type || 'video',
        duration
      }
    });

  } catch (err) {
    console.error('🔥 getCallById error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Get ongoing calls for a user
 */
async function getOngoingCalls(req, res) {
  try {
    const { userId } = req.params;
    const ongoingCalls = await Call.find({
      $or: [{ callerId: userId }, { calleeId: userId }],
      status: { $in: ['ringing', 'accepted'] }
    })
      .populate('callerId', 'firstName lastName profilePicture')
      .populate('calleeId', 'firstName lastName profilePicture')
      .sort({ createdAt: -1 });

    const calls = ongoingCalls.map(call => {
      const callerName = call.callerId ? `${call.callerId.firstName} ${call.callerId.lastName}`.trim() : 'Unknown';
      const calleeName = call.calleeId ? `${call.calleeId.firstName} ${call.calleeId.lastName}`.trim() : 'Unknown';
      const callerImage = call.callerId?.profilePicture || '';
      const calleeImage = call.calleeId?.profilePicture || '';

      const endedAt = call.endedAt || (call.status === 'ended' ? call.updatedAt : null);
      const duration = endedAt
        ? Math.floor((endedAt - call.createdAt) / 1000)
        : Math.floor((Date.now() - call.createdAt) / 1000);

      return {
        _id: call._id,
        id: call.callId,
        callId: call.callId,
        roomId: call.roomId,
        callerId: call.callerId?._id,
        callerName,
        callerImage,
        receiverId: call.calleeId?._id,
        receiverName: calleeName,
        receiverImage: calleeImage,
        status: call.status,
        startedAt: call.createdAt,
        endedAt,
        type: call.type || 'video',
        duration
      };
    });

    res.json({ success: true, calls });

  } catch (err) {
    console.error('🔥 getOngoingCalls error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = {
  startCall,
  acceptCall,
  declineCall,
  endCall,
  getCallById,
  getOngoingCalls
};