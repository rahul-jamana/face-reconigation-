const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { dbQuery, dbGet, dbRun } = require('../db/database');

const GATE_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'gate_logs');
if (!fs.existsSync(GATE_UPLOADS_DIR)) {
  fs.mkdirSync(GATE_UPLOADS_DIR, { recursive: true });
}

// GET /api/security/alerts - Fetch all security alerts
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await dbQuery(`
      SELECT sa.*, 
             COALESCE(sa.image_snapshot, sa.photo_url) as snapshot_url,
             s.name as student_name, 
             s.branch, 
             s.roll_number 
      FROM security_alerts sa
      LEFT JOIN students s ON (sa.student_id = s.student_id OR sa.student_id = s.roll_number)
      ORDER BY sa.id DESC LIMIT 50
    `);
    res.json({ success: true, count: alerts.length, alerts });
  } catch (err) {
    console.error('Error fetching security alerts:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch security alerts' });
  }
});

// POST /api/security/acknowledge/:id - Guard acknowledge alert
router.post('/acknowledge/:id', async (req, res) => {
  try {
    const alertId = req.params.id;
    const { guard_notes, guard_name } = req.body;
    
    await dbRun(`
      UPDATE security_alerts 
      SET is_acknowledged = 1, 
          acknowledged_by = ?, 
          notes = ?
      WHERE id = ?
    `, [guard_name || 'Security Guard', guard_notes || 'Acknowledged and verified', alertId]);

    res.json({ success: true, message: 'Alert acknowledged successfully' });
  } catch (err) {
    console.error('Error acknowledging alert:', err);
    res.status(500).json({ success: false, message: 'Failed to acknowledge alert' });
  }
});

// POST /api/security/trigger-alert - Log Covered/Unknown Face or Security Incident with Photo
router.post('/trigger-alert', async (req, res) => {
  try {
    const { alert_type, camera_id, notes, image_path, snapshot_base64, student_id } = req.body;
    
    let photoUrl = image_path || '';
    if (snapshot_base64) {
      const base64Data = snapshot_base64.replace(/^data:image\/\w+;base64,/, '');
      const fileName = `alert_${(alert_type || 'INCIDENT').toLowerCase()}_${Date.now()}.jpg`;
      const relativePath = path.join('uploads', 'gate_logs', fileName).replace(/\\/g, '/');
      const fullPath = path.join(__dirname, '..', relativePath);
      fs.writeFileSync(fullPath, base64Data, { encoding: 'base64' });
      photoUrl = '/' + relativePath;
    }

    const result = await dbRun(`
      INSERT INTO security_alerts (student_id, camera_id, alert_type, image_snapshot, photo_url, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      student_id || null, 
      camera_id || 'SECURITY_DESK', 
      alert_type || 'FACE_HIDDEN', 
      photoUrl,
      photoUrl,
      notes || 'Covered face / unknown person detected'
    ]);

    // Also insert into gate_entry_exit_logs for full audit trail
    await dbRun(`
      INSERT INTO gate_entry_exit_logs (student_id, log_type, camera_id, gate_name, face_matched, alert_type, photo_url, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      student_id || 'UNKNOWN',
      'ENTRY',
      camera_id || 'CAMERA_1_ENTRY',
      'Hostel Gate',
      0,
      alert_type || 'FACE_HIDDEN',
      photoUrl,
      notes || 'Covered face detected'
    ]);

    res.json({ success: true, alert_id: result.lastID, photo_url: photoUrl, message: 'Security alert & snapshot logged' });
  } catch (err) {
    console.error('Error triggering security alert:', err);
    res.status(500).json({ success: false, message: 'Failed to trigger alert' });
  }
});

// GET /api/security/live-stream - Live gate stream & system health status
router.get('/live-stream', async (req, res) => {
  try {
    const recentLogs = await dbQuery(`
      SELECT g.*, s.name, s.roll_number 
      FROM gate_entry_exit_logs g
      LEFT JOIN students s ON g.student_id = s.student_id
      ORDER BY g.id DESC LIMIT 15
    `);

    const unackAlerts = await dbGet(`
      SELECT COUNT(*) as count FROM security_alerts WHERE is_acknowledged = 0
    `);

    res.json({
      success: true,
      status: 'ONLINE',
      active_cameras: [
        { id: 'CAMERA_1_ENTRY', name: 'Hostel Main Gate 1 (Entry)', status: 'ACTIVE', fps: 30 },
        { id: 'CAMERA_2_EXIT', name: 'Hostel Main Gate 2 (Exit)', status: 'ACTIVE', fps: 30 }
      ],
      unacknowledged_alerts: unackAlerts ? unackAlerts.count : 0,
      recent_gate_logs: recentLogs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch live stream status' });
  }
});

// DELETE /api/security/alerts/:id - Delete single security alert
router.delete('/alerts/:id', async (req, res) => {
  try {
    const alertId = req.params.id;
    await dbRun('DELETE FROM security_alerts WHERE id = ?', [alertId]);
    res.json({ success: true, message: 'Security alert deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete security alert' });
  }
});

// DELETE /api/security/alerts-all - Bulk clear all security alerts
router.delete('/alerts-all', async (req, res) => {
  try {
    await dbRun('DELETE FROM security_alerts');
    res.json({ success: true, message: 'All security alerts cleared cleanly.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear security alerts' });
  }
});

module.exports = router;
