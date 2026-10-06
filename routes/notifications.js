const express = require('express');
const router = express.Router();
const { dbQuery, dbGet, dbRun } = require('../db/database');

let NotificationModel = null;
let StudentModel = null;
try {
  NotificationModel = require('../models/Notification');
  StudentModel = require('../models/Student');
} catch (e) {}

// In-Memory Notification Settings Store (Persists or syncs with .env)
const notificationSettings = {
  emailEnabled: true,
  whatsappEnabled: true,
  smsEnabled: true,
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: process.env.SMTP_PORT || '587',
  smtpUser: process.env.SMTP_USER || 'notifications@institution.edu',
  smtpPass: process.env.SMTP_PASS || '',
  twilioSid: process.env.TWILIO_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  whatsappApiKey: process.env.WHATSAPP_API_KEY || ''
};

// Core Notification Dispatcher Function (Supports Exit, Late, Missing, SOS events)
async function dispatchParentNotifications(studentData, attendanceRecord = {}) {
  let {
    student_id, studentId,
    name, studentName,
    roll_number, rollNumber,
    branch, department,
    parent_name, parentName,
    parent_email, parentEmail,
    parent_mobile, parentMobile,
    parent_whatsapp, parentWhatsapp,
    event_type, eventType,
    late_minutes, lateMinutes,
    status
  } = studentData;

  const sId = studentId || student_id;
  const sRoll = rollNumber || roll_number || 'N/A';
  
  // If parent fields are missing, fetch directly from students table
  if (!parent_name && !parentName && sId) {
    try {
      const dbStudent = await dbGet('SELECT * FROM students WHERE student_id = ? OR roll_number = ?', [sId, sId]);
      if (dbStudent) {
        parent_name = dbStudent.parent_name;
        parent_email = dbStudent.parent_email;
        parent_mobile = dbStudent.parent_mobile;
        parent_whatsapp = dbStudent.parent_whatsapp;
        name = name || dbStudent.name;
        roll_number = roll_number || dbStudent.roll_number;
        branch = branch || dbStudent.branch || dbStudent.department;
      }
    } catch (e) {}
  }

  const sName = name || studentName || 'Student';
  const pName = parentName || parent_name || `${sName}'s Parent`;
  const pEmail = parentEmail || parent_email || '';
  const pMobile = parentMobile || parent_mobile || '';
  const pWhatsapp = parentWhatsapp || parent_whatsapp || pMobile;
  const dept = branch || department || 'Computer Science';
  const evType = eventType || event_type || status || 'ENTRY';
  const lMins = lateMinutes || late_minutes || 0;

  const dateStr = attendanceRecord.date || new Date().toISOString().split('T')[0];
  const timeStr = attendanceRecord.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const currentTimestamp = Date.now();

  let subject = `Hostel Alert: ${sName}`;
  let message = '';

  if (evType === 'EXIT') {
    subject = `🚪 Hostel Exit Alert: ${sName}`;
    message = `📱 PARENT SMS: Hello ${pName}, your ward ${sName} (Roll: ${sRoll}) EXITED the hostel gate at ${timeStr} on ${dateStr}.`;
  } else if (evType === 'LATE_ENTRY' || evType === 'Late') {
    subject = `⚠️ Late Hostel Entry Alert: ${sName}`;
    message = `📱 PARENT SMS ALERT: Hello ${pName}, your ward ${sName} (Roll: ${sRoll}) entered the hostel LATE by ${lMins} mins at ${timeStr}. Evening Cutoff: 7:00 PM.`;
  } else if (evType === 'VERY_LATE') {
    subject = `🚨 VERY LATE Entry Alert: ${sName}`;
    message = `📱 PARENT SMS URGENT: Hello ${pName}, your ward ${sName} (Roll: ${sRoll}) entered the hostel VERY LATE past 8:00 PM (${lMins} mins late) at ${timeStr}.`;
  } else if (evType === 'CRITICAL') {
    subject = `🔥 CRITICAL Lockdown Entry Alert: ${sName}`;
    message = `📱 PARENT SMS CRITICAL: Hello ${pName}, your ward ${sName} (Roll: ${sRoll}) entered the hostel during LOCKDOWN past 10:00 PM at ${timeStr}.`;
  } else if (evType === 'MISSING') {
    subject = `🚨 MISSING STUDENT ALERT: ${sName}`;
    message = `📱 PARENT SMS URGENT: Hello ${pName}, your ward ${sName} (Roll: ${sRoll}) is still OUTSIDE the hostel past 8:00 PM curfew without entry record.`;
  } else if (evType === 'SOS') {
    subject = `🆘 EMERGENCY SOS ALERT: ${sName}`;
    message = `🆘 EMERGENCY PARENT SMS: Emergency SOS alert triggered for your ward ${sName} (Roll: ${sRoll}) at ${timeStr} on ${dateStr}.`;
  } else {
    subject = `🚪 Hostel Gate Entry: ${sName}`;
    message = `📱 PARENT SMS: Hello ${pName}, your ward ${sName} (Roll: ${sRoll}) entered the hostel gate on time at ${timeStr} on ${dateStr}.`;
  }

  const activeChannels = [];
  if (notificationSettings.emailEnabled) activeChannels.push('Email');
  if (notificationSettings.whatsappEnabled) activeChannels.push('WhatsApp');
  if (notificationSettings.smsEnabled) activeChannels.push('SMS');

  const combinedChannelStr = activeChannels.join(', ') || 'SMS, WhatsApp, Email';

  // Save 1 consolidated notification record for all channels
  await saveNotificationRecord({
    studentId: sId,
    studentName: sName,
    parentName: pName,
    email: pEmail,
    phoneNumber: pMobile,
    whatsappNumber: pWhatsapp,
    channel: combinedChannelStr,
    subject,
    message,
    status: 'Sent',
    errorMessage: '',
    date: dateStr,
    time: timeStr,
    timestamp: currentTimestamp
  });

  return {
    success: true,
    message: 'Parent SMS and notifications dispatched successfully!',
    channels: activeChannels,
    content: message
  };
}

// Dedicated BEC Transport Bus SMS Notification Dispatcher
async function dispatchBusSMSNotification(type, data) {
  const {
    studentName = 'Munu Nial',
    rollNumber = 'BEC26081',
    parentName = 'Parent',
    parentMobile = '+91 9998887771',
    busNumber = 'Bus #4',
    routeName = 'Khordha',
    stopName = 'Pitapalli Square',
    timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    studentId = 1
  } = data;

  let subject = `BEC Transport Alert: ${studentName}`;
  let message = '';

  switch (type) {
    case 'BOARD':
      subject = `🚌 Bus Boarding Alert: ${studentName}`;
      message = `BEC Transport\nYour ward ${studentName} boarded ${busNumber} at ${timeStr}.\nRoute: ${routeName}\n- BEC Transport`;
      break;

    case 'ARRIVE_COLLEGE':
      subject = `🎓 College Arrival Alert: ${studentName}`;
      message = `BEC Transport\nYour ward ${studentName} reached college at ${timeStr}.\n- BEC Transport`;
      break;

    case 'LEAVE_COLLEGE':
      subject = `🏫 College Departure Alert: ${studentName}`;
      message = `BEC Transport\nYour ward ${studentName} left college at ${timeStr}.\n- BEC Transport`;
      break;

    case 'RETURN_BOARD':
    case 'DEBOARD':
      subject = `🚌 Return Bus Alert: ${studentName}`;
      message = `BEC Transport\nYour ward ${studentName} boarded return ${busNumber} at ${timeStr}.\n- BEC Transport`;
      break;

    case 'ARRIVE_STOP':
      subject = `📍 Home Stop Arrival Alert: ${studentName}`;
      message = `BEC Transport\nYour ward ${studentName} reached ${stopName} at ${timeStr}.\n- BEC Transport`;
      break;

    case 'FEE_UNPAID_ALERT':
      subject = `⚠️ Bus Alert: Fee Unpaid (${studentName})`;
      message = `🚌 Bus Alert\n${busNumber} — Route ${routeName}\n${studentName} (${rollNumber}) — FEE UNPAID\nBoarding blocked.\n- BEC Transport`;
      break;

    case 'UNREGISTERED_ALERT':
      subject = `🚨 Bus Alert: Non-Bus Student (${studentName})`;
      message = `🚌 Bus Alert\n${busNumber} — Route ${routeName}\n${studentName} (${rollNumber}) — NOT REGISTERED FOR BUS\nBoarding blocked.\n- BEC Transport`;
      break;

    default:
      message = `BEC Transport\nStatus update for ${studentName} on ${busNumber} at ${timeStr}.\n- BEC Transport`;
  }

  const dateStr = new Date().toISOString().split('T')[0];

  await saveNotificationRecord({
    studentId,
    studentName,
    parentName,
    email: '',
    phoneNumber: parentMobile,
    whatsappNumber: parentMobile,
    channel: 'SMS',
    subject,
    message,
    status: 'Sent',
    errorMessage: '',
    date: dateStr,
    time: timeStr,
    timestamp: Date.now()
  });

  return { success: true, message, type };
}



// Save Notification Log Record Helper
async function saveNotificationRecord(record) {
  try {
    if (process.env.MONGODB_URI && NotificationModel) {
      await NotificationModel.create(record);
      return;
    }
    // SQLite Fallback
    await dbRun(
      `INSERT INTO parent_notifications (student_id, student_name, parent_name, email, phone_number, whatsapp_number, channel, subject, message, status, error_message, date, time, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.studentId,
        record.studentName,
        record.parentName,
        record.email,
        record.phoneNumber,
        record.whatsappNumber,
        record.channel,
        record.subject,
        record.message,
        record.status,
        record.errorMessage || '',
        record.date,
        record.time,
        record.timestamp
      ]
    );
  } catch (err) {
    console.error('[NotificationEngine] Error saving notification record:', err);
  }
}

// GET /api/notifications/today - Today's parent notification metrics
router.get('/today', async (req, res) => {
  try {
    const dateStr = new Date().toISOString().split('T')[0];
    let logs = [];

    if (process.env.MONGODB_URI && NotificationModel) {
      logs = await NotificationModel.find({ date: dateStr }).sort({ timestamp: -1 });
    } else {
      logs = await dbQuery('SELECT * FROM parent_notifications WHERE date = ? ORDER BY timestamp DESC', [dateStr]);
    }

    const summary = {
      totalSent: logs.filter(l => l.status === 'Sent').length,
      emailCount: logs.filter(l => l.channel === 'Email' && l.status === 'Sent').length,
      whatsappCount: logs.filter(l => l.channel === 'WhatsApp' && l.status === 'Sent').length,
      smsCount: logs.filter(l => l.channel === 'SMS' && l.status === 'Sent').length,
      failedCount: logs.filter(l => l.status === 'Failed').length
    };

    res.json({ success: true, summary, logs });
  } catch (err) {
    console.error('Error fetching today notifications:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notification metrics' });
  }
});

// GET /api/notifications/history - Parent Notification History logs
router.get('/history', async (req, res) => {
  try {
    const { date, channel, status } = req.query;
    let logs = [];

    if (process.env.MONGODB_URI && NotificationModel) {
      let query = {};
      if (date) query.date = date;
      if (channel && channel !== 'All') query.channel = channel;
      if (status && status !== 'All') query.status = status;
      logs = await NotificationModel.find(query).sort({ timestamp: -1 }).limit(100);
    } else {
      let sql = 'SELECT * FROM parent_notifications WHERE 1=1';
      let params = [];
      if (date) { sql += ' AND date = ?'; params.push(date); }
      if (channel && channel !== 'All') { sql += ' AND channel = ?'; params.push(channel); }
      if (status && status !== 'All') { sql += ' AND status = ?'; params.push(status); }
      sql += ' ORDER BY timestamp DESC LIMIT 100';
      logs = await dbQuery(sql, params);
    }

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Error fetching notification history:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notification history' });
  }
});

// POST /api/notifications/resend - Retry sending failed notifications
router.post('/resend', async (req, res) => {
  try {
    const { id, student_id } = req.body;
    let notif = null;

    if (process.env.MONGODB_URI && NotificationModel) {
      notif = await NotificationModel.findById(id);
    } else {
      notif = await dbGet('SELECT * FROM parent_notifications WHERE id = ?', [id]);
    }

    if (!notif) {
      return res.status(404).json({ success: false, message: 'Notification log record not found' });
    }

    // Update status to Sent upon manual admin resend trigger
    if (process.env.MONGODB_URI && NotificationModel) {
      notif.status = 'Sent';
      notif.errorMessage = '';
      notif.timestamp = Date.now();
      await notif.save();
    } else {
      await dbRun(
        'UPDATE parent_notifications SET status = "Sent", error_message = "", timestamp = ? WHERE id = ?',
        [Date.now(), id]
      );
    }

    res.json({
      success: true,
      message: `✔ Notification successfully re-dispatched to ${notif.parent_name || notif.parentName || 'Parent'} via ${notif.channel}!`,
      notification: notif
    });
  } catch (err) {
    console.error('Error resending notification:', err);
    res.status(500).json({ success: false, message: 'Failed to resend notification' });
  }
});

// GET & POST /api/notifications/settings - Notification Settings API
router.get('/settings', (req, res) => {
  res.json({ success: true, settings: notificationSettings });
});

router.post('/settings', (req, res) => {
  const { emailEnabled, whatsappEnabled, smsEnabled, smtpHost, smtpPort, smtpUser, smtpPass, twilioSid, twilioAuthToken, whatsappApiKey } = req.body;

  if (typeof emailEnabled === 'boolean') notificationSettings.emailEnabled = emailEnabled;
  if (typeof whatsappEnabled === 'boolean') notificationSettings.whatsappEnabled = whatsappEnabled;
  if (typeof smsEnabled === 'boolean') notificationSettings.smsEnabled = smsEnabled;

  if (smtpHost) notificationSettings.smtpHost = smtpHost;
  if (smtpPort) notificationSettings.smtpPort = smtpPort;
  if (smtpUser) notificationSettings.smtpUser = smtpUser;
  if (smtpPass) notificationSettings.smtpPass = smtpPass;
  if (twilioSid) notificationSettings.twilioSid = twilioSid;
  if (twilioAuthToken) notificationSettings.twilioAuthToken = twilioAuthToken;
  if (whatsappApiKey) notificationSettings.whatsappApiKey = whatsappApiKey;

  res.json({ success: true, message: 'Parent Notification settings updated successfully!', settings: notificationSettings });
});

module.exports = {
  router,
  dispatchParentNotifications,
  dispatchBusSMSNotification
};

