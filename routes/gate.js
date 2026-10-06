const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { dbQuery, dbGet, dbRun } = require('../db/database');
const { dispatchParentNotifications } = require('./notifications');

const GATE_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'gate_logs');
if (!fs.existsSync(GATE_UPLOADS_DIR)) {
  fs.mkdirSync(GATE_UPLOADS_DIR, { recursive: true });
}

// POST /api/gate/entry - Process Camera 1 (ENTRY)
router.post('/entry', async (req, res) => {
  try {
    const { student_id, studentId, confidence, anti_spoof_passed, snapshot_base64, gate_name } = req.body;
    const sId = studentId || student_id;
    const conf = confidence || 95.0;
    const gate = gate_name || 'Main Hostel Gate';

    let photoPath = '';
    if (snapshot_base64) {
      const base64Data = snapshot_base64.replace(/^data:image\/\w+;base64,/, '');
      const fileName = `entry_${sId || 'unknown'}_${Date.now()}.jpg`;
      const relativePath = path.join('uploads', 'gate_logs', fileName).replace(/\\/g, '/');
      const fullPath = path.join(__dirname, '..', relativePath);
      fs.writeFileSync(fullPath, base64Data, { encoding: 'base64' });
      photoPath = relativePath;
    }

    if (!sId) {
      // Log Unknown Person Alert
      await dbRun(
        `INSERT INTO security_alerts (alert_type, camera_id, gate_name, photo_url, notes) VALUES (?, ?, ?, ?, ?)`,
        ['UNKNOWN', 'CAMERA_1_ENTRY', gate, photoPath, 'Unrecognized person at entry gate']
      );

      await dbRun(
        `INSERT INTO gate_entry_exit_logs (student_id, log_type, camera_id, gate_name, face_matched, alert_type, photo_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['UNKNOWN', 'ENTRY', 'CAMERA_1_ENTRY', gate, 0, 'UNKNOWN', photoPath, 'Unknown face at Entry camera']
      );

      return res.json({
        success: false,
        alert: 'UNKNOWN',
        message: '🚨 Unknown person detected at Gate! Security alert generated.'
      });
    }

    const student = await dbGet('SELECT * FROM students WHERE student_id = ? OR roll_number = ?', [sId, sId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Multi-Tier Time-Based Rules Engine (7 PM Curfew, 8 PM Final Alert, 10 PM Lockdown)
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    
    const curfewMins = 19 * 60; // 7:00 PM
    const finalAlertMins = 20 * 60; // 8:00 PM
    const lockdownMins = 22 * 60; // 10:00 PM

    let alertType = 'NONE';
    let alertMsg = 'On Time Entry';
    let isLate = 0;
    let lateMins = 0;

    if (totalMinutes > lockdownMins) {
      lateMins = totalMinutes - curfewMins;
      alertType = 'CRITICAL';
      isLate = 1;
      alertMsg = `CRITICAL Lockdown Entry past 10 PM (${Math.floor(lateMins / 60)}h ${lateMins % 60}m late)`;
    } else if (totalMinutes > finalAlertMins) {
      lateMins = totalMinutes - curfewMins;
      alertType = 'VERY_LATE';
      isLate = 1;
      alertMsg = `VERY LATE Entry past 8 PM (${Math.floor(lateMins / 60)}h ${lateMins % 60}m late)`;
    } else if (totalMinutes > curfewMins) {
      lateMins = totalMinutes - curfewMins;
      alertType = 'LATE_ENTRY';
      isLate = 1;
      alertMsg = `Late Entry by ${Math.floor(lateMins / 60)}h ${lateMins % 60}m`;
    }

    if (isLate) {
      // Log Security Alert for Late / Critical Entry
      await dbRun(
        `INSERT INTO security_alerts (alert_type, camera_id, gate_name, photo_url, student_id, notes) VALUES (?, ?, ?, ?, ?, ?)`,
        [alertType, 'CAMERA_1_ENTRY', gate, photoPath, student.student_id, `${student.name} (${student.roll_number}) entered late: ${alertMsg}`]
      );
    }

    // Insert Entry Log with new columns
    const logResult = await dbRun(
      `INSERT INTO gate_entry_exit_logs (student_id, roll_number, log_type, camera_id, gate_name, face_matched, face_confidence, anti_spoof_passed, alert_type, photo_url, notes, late_minutes, is_late, is_missing, parent_notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [student.student_id, student.roll_number, 'ENTRY', 'CAMERA_1_ENTRY', gate, 1, conf, anti_spoof_passed ? 1 : 0, alertType, photoPath, alertMsg, lateMins, isLate, 0, 1]
    );

    // Also mark main attendance if not marked today
    const dateStr = now.toISOString().split('T')[0];
    const existingAtt = await dbGet('SELECT * FROM attendance WHERE student_id = ? AND date = ?', [student.student_id, dateStr]);
    if (!existingAtt) {
      await dbRun(
        `INSERT INTO attendance (student_id, date, time, timestamp, status, mode, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [student.student_id, dateStr, now.toLocaleTimeString(), now.getTime(), isLate ? 'Late' : 'Present', 'Hostel Gate Camera 1', conf]
      );
    }

    // Dispatch Parent Notifications / SMS
    try {
      await dispatchParentNotifications({
        student_id: student.student_id,
        roll_number: student.roll_number,
        name: student.name,
        parent_name: student.parent_name || 'Parent',
        email: student.parent_email || student.email,
        mobile: student.parent_mobile || student.mobile,
        whatsapp: student.parent_whatsapp || student.mobile,
        event_type: alertType,
        late_minutes: lateMins,
        status: isLate ? alertType : 'Present',
        date: dateStr,
        time: now.toLocaleTimeString()
      });
    } catch (nErr) {}

    // Update hostel_daily_stats
    try {
      await dbRun(`
        INSERT INTO hostel_daily_stats (hostel_id, hostel_name, stat_date, total_in, late_count)
        VALUES (1, 'Boys Hostel A', ?, 1, ?)
        ON CONFLICT(id) DO NOTHING
      `, [dateStr, isLate ? 1 : 0]);
    } catch (sErr) {}

    res.json({
      success: true,
      log_id: logResult.id,
      student: {
        student_id: student.student_id,
        name: student.name,
        roll_number: student.roll_number,
        branch: student.branch
      },
      log_type: 'ENTRY',
      alert_type: alertType,
      is_late: isLate,
      late_minutes: lateMins,
      time: now.toLocaleTimeString(),
      message: `🚪 Entry Logged: ${student.name} (${alertMsg})`
    });
  } catch (err) {
    console.error('Error in /api/gate/entry:', err);
    res.status(500).json({ success: false, message: 'Gate entry processing error' });
  }
});

// POST /api/gate/exit - Process Camera 2 (EXIT)
router.post('/exit', async (req, res) => {
  try {
    const { student_id, studentId, confidence, anti_spoof_passed, snapshot_base64, gate_name } = req.body;
    const sId = studentId || student_id;
    const conf = confidence || 95.0;
    const gate = gate_name || 'Main Hostel Gate';

    let photoPath = '';
    if (snapshot_base64) {
      const base64Data = snapshot_base64.replace(/^data:image\/\w+;base64,/, '');
      const fileName = `exit_${sId || 'unknown'}_${Date.now()}.jpg`;
      const relativePath = path.join('uploads', 'gate_logs', fileName).replace(/\\/g, '/');
      const fullPath = path.join(__dirname, '..', relativePath);
      fs.writeFileSync(fullPath, base64Data, { encoding: 'base64' });
      photoPath = relativePath;
    }

    if (!sId) {
      await dbRun(
        `INSERT INTO security_alerts (alert_type, camera_id, gate_name, photo_url, notes) VALUES (?, ?, ?, ?, ?)`,
        ['UNKNOWN', 'CAMERA_2_EXIT', gate, photoPath, 'Unrecognized person at exit gate']
      );

      await dbRun(
        `INSERT INTO gate_entry_exit_logs (student_id, log_type, camera_id, gate_name, face_matched, alert_type, photo_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['UNKNOWN', 'EXIT', 'CAMERA_2_EXIT', gate, 0, 'UNKNOWN', photoPath, 'Unknown face at Exit camera']
      );

      return res.json({
        success: false,
        alert: 'UNKNOWN',
        message: '🚨 Unknown person detected leaving Gate! Security alert logged.'
      });
    }

    const student = await dbGet('SELECT * FROM students WHERE student_id = ? OR roll_number = ?', [sId, sId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const normalExitMins = 16 * 60; // 4:00 PM

    let alertType = 'NONE';
    let alertMsg = 'Normal Hostel Exit';

    if (totalMinutes < normalExitMins) {
      alertType = 'EARLY_EXIT';
      alertMsg = 'Early Exit before 4:00 PM (Check Gate Pass)';
    }

    const logResult = await dbRun(
      `INSERT INTO gate_entry_exit_logs (student_id, roll_number, log_type, camera_id, gate_name, face_matched, face_confidence, anti_spoof_passed, alert_type, photo_url, notes, parent_notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [student.student_id, student.roll_number, 'EXIT', 'CAMERA_2_EXIT', gate, 1, conf, anti_spoof_passed ? 1 : 0, alertType, photoPath, alertMsg, 1]
    );

    // Dispatch Parent Notification for Exit
    try {
      await dispatchParentNotifications({
        student_id: student.student_id,
        roll_number: student.roll_number,
        name: student.name,
        parent_name: student.parent_name || 'Parent',
        email: student.parent_email || student.email,
        mobile: student.parent_mobile || student.mobile,
        whatsapp: student.parent_whatsapp || student.mobile,
        event_type: 'EXIT',
        date: now.toISOString().split('T')[0],
        time: now.toLocaleTimeString()
      });
    } catch (nErr) {}


    res.json({
      success: true,
      log_id: logResult.id,
      student: {
        student_id: student.student_id,
        name: student.name,
        roll_number: student.roll_number,
        branch: student.branch
      },
      log_type: 'EXIT',
      time: now.toLocaleTimeString(),
      message: `🚪 Exit Logged: ${student.name}`
    });
  } catch (err) {
    console.error('Error in /api/gate/exit:', err);
    res.status(500).json({ success: false, message: 'Gate exit processing error' });
  }
});

// GET /api/gate/logs - Get recent gate logs
router.get('/logs', async (req, res) => {
  try {
    const logs = await dbQuery(`
      SELECT g.*, 
             COALESCE(s.name, 'Student (' || COALESCE(g.roll_number, g.student_id) || ')') as name,
             s.name as student_name, 
             s.branch, 
             s.mobile 
      FROM gate_entry_exit_logs g 
      LEFT JOIN students s ON (g.student_id = s.student_id OR g.roll_number = s.roll_number OR g.student_id = s.roll_number) 
      ORDER BY g.id DESC LIMIT 50
    `);
    res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve gate logs' });
  }
});

// GET /api/gate/live - Current IN/OUT hostel status summary
router.get('/live', async (req, res) => {
  try {
    const totalStudents = await dbGet('SELECT COUNT(*) as count FROM students');
    const logs = await dbQuery(`
      SELECT student_id, log_type, log_time 
      FROM gate_entry_exit_logs 
      WHERE id IN (SELECT MAX(id) FROM gate_entry_exit_logs WHERE student_id IS NOT 'UNKNOWN' GROUP BY student_id)
    `);

    let insideCount = 0;
    let outsideCount = 0;

    logs.forEach(l => {
      if (l.log_type === 'ENTRY') insideCount++;
      else if (l.log_type === 'EXIT') outsideCount++;
    });

    const unknownLogs = await dbGet(`SELECT COUNT(*) as count FROM gate_entry_exit_logs WHERE alert_type = 'UNKNOWN' AND date(log_time) = date('now')`);
    const lateLogs = await dbGet(`SELECT COUNT(*) as count FROM gate_entry_exit_logs WHERE alert_type = 'LATE_ENTRY' AND date(log_time) = date('now')`);

    res.json({
      success: true,
      live: {
        presentInsideHostel: insideCount,
        currentlyOutside: (totalStudents ? totalStudents.count - insideCount : 0),
        lateEntriesToday: lateLogs ? lateLogs.count : 0,
        unacknowledgedAlerts: unknownLogs ? unknownLogs.count : 0
      },
      stats: {
        totalStudents: totalStudents ? totalStudents.count : 0,
        insideHostel: insideCount,
        outsideHostel: (totalStudents ? totalStudents.count - insideCount : 0),
        lateEntriesToday: lateLogs ? lateLogs.count : 0,
        unknownAlertsToday: unknownLogs ? unknownLogs.count : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve live gate status' });
  }
});

// POST /api/gate/register-student-30frames - Register New Student with 30-Frame Face Embeddings
router.post('/register-student-30frames', async (req, res) => {
  try {
    const {
      name,
      roll_number,
      branch,
      dob,
      academic_year,
      mobile,
      parent_name,
      parent_mobile,
      descriptors,
      photo_base64
    } = req.body;

    if (!name || !roll_number) {
      return res.status(400).json({ success: false, message: 'Student Name and Roll Number are required.' });
    }

    const studentId = `STU-${Date.now().toString().slice(-6)}`;
    const regNo = `REG-${new Date().getFullYear()}-${roll_number}`;

    // Save photo snapshot if present
    let photoUrl = '';
    if (photo_base64) {
      const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
      const fileName = `student_${studentId}.jpg`;
      const relativePath = path.join('uploads', 'gate_logs', fileName).replace(/\\/g, '/');
      const fullPath = path.join(__dirname, '..', relativePath);
      fs.writeFileSync(fullPath, base64Data, { encoding: 'base64' });
      photoUrl = '/' + relativePath;
    }

    // Insert student record with face_enrolled = 1
    await dbRun(`
      INSERT INTO students (
        student_id, name, roll_number, registration_number, branch, department, semester, section,
        mobile, parent_name, parent_mobile, dob, academic_year, photo_path, face_enrolled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      studentId, name, roll_number, regNo, branch || 'General', branch || 'General', '1', 'A',
      mobile || '', parent_name || 'Parent', parent_mobile || mobile || '', dob || '', academic_year || '2026', photoUrl
    ]);

    // Save face descriptors (up to 30 frames) into face_embeddings table
    let descriptorAvg = null;
    if (descriptors && Array.isArray(descriptors) && descriptors.length > 0) {
      for (const desc of descriptors) {
        await dbRun(`
          INSERT INTO face_embeddings (student_id, descriptor_json, image_path)
          VALUES (?, ?, ?)
        `, [studentId, JSON.stringify(desc), photoUrl]);
      }
      descriptorAvg = descriptors[0]; // primary embedding sample
    }

    // Save multi-pose student face data safely
    try {
      await dbRun(`
        INSERT INTO student_face_data (
          student_id, roll_number, face_embedding, photo_url, status
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        studentId, roll_number, JSON.stringify(descriptorAvg || []), photoUrl, 'ACTIVE'
      ]);
    } catch (e) {
      console.warn('Note: student_face_data optional logging warning:', e.message);
    }

    // Initial Gate Entry Log (Default student inside hostel upon registration)
    await dbRun(`
      INSERT INTO gate_entry_exit_logs (student_id, roll_number, log_type, camera_id, gate_name, face_matched, alert_type, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [studentId, roll_number, 'ENTRY', 'REGISTRATION_DESK', 'Hostel Desk', 1, 'NONE', 'Registered with 30-Frame Face Scanner']);

    res.json({
      success: true,
      student_id: studentId,
      message: `🎉 Student ${name} registered successfully with 30-Frame Face Recognition Engine!`
    });
  } catch (err) {
    console.error('Error in register-student-30frames:', err);
    res.status(500).json({ success: false, message: 'Failed to register student: ' + err.message });
  }
});

// DELETE /api/gate/logs/:id - Delete single gate log entry
router.delete('/logs/:id', async (req, res) => {
  try {
    const logId = req.params.id;
    await dbRun('DELETE FROM gate_entry_exit_logs WHERE id = ?', [logId]);
    res.json({ success: true, message: 'Gate log entry deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete gate log' });
  }
});

// DELETE /api/gate/logs-all - Bulk clear all gate movement logs
router.delete('/logs-all', async (req, res) => {
  try {
    await dbRun('DELETE FROM gate_entry_exit_logs');
    res.json({ success: true, message: 'All gate movement activity logs cleared cleanly.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear gate logs' });
  }
});

// =========================================================================
// DAILY CSV ARCHIVING & AUTOMATIC 1-DAY LOG DATA CLEANUP ENGINE
// =========================================================================

const DAILY_CSV_DIR = path.join(__dirname, '..', 'uploads', 'daily_csv_logs');
if (!fs.existsSync(DAILY_CSV_DIR)) {
  fs.mkdirSync(DAILY_CSV_DIR, { recursive: true });
}

// Helper to escape values for CSV output
function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// Core Archiver & 1-Day Log Purge Engine
async function archiveAndCleanupOldLogs(forceAll = false) {
  try {
    let sqlCondition = "datetime(g.created_at) < datetime('now', '-1 day') OR datetime(g.log_time) < datetime('now', '-1 day')";
    let attCondition = "datetime(created_at) < datetime('now', '-1 day') OR date(date) < date('now', '-1 day')";
    
    if (forceAll) {
      sqlCondition = "1=1";
      attCondition = "1=1";
    }

    const oldGateLogs = await dbQuery(`
      SELECT g.*, 
             COALESCE(s.name, 'Student (' || COALESCE(g.roll_number, g.student_id) || ')') as student_name,
             s.branch, 
             s.mobile 
      FROM gate_entry_exit_logs g 
      LEFT JOIN students s ON (g.student_id = s.student_id OR g.roll_number = s.roll_number OR g.student_id = s.roll_number) 
      WHERE ${sqlCondition}
      ORDER BY g.id ASC
    `);

    if (!oldGateLogs || oldGateLogs.length === 0) {
      return {
        success: true,
        archivedCount: 0,
        message: 'No logs older than 1 day were found to archive.'
      };
    }

    // Group logs by date (YYYY-MM-DD)
    const logsByDate = {};
    oldGateLogs.forEach(log => {
      let dateKey = '';
      if (log.log_time && log.log_time.includes('T')) {
        dateKey = log.log_time.split('T')[0];
      } else if (log.log_time && log.log_time.includes(' ')) {
        dateKey = log.log_time.split(' ')[0];
      } else if (log.created_at) {
        dateKey = String(log.created_at).split('T')[0].split(' ')[0];
      } else {
        dateKey = new Date().toISOString().split('T')[0];
      }

      if (!logsByDate[dateKey]) logsByDate[dateKey] = [];
      logsByDate[dateKey].push(log);
    });

    let totalArchived = 0;
    const filesGenerated = [];

    for (const [dateStr, logs] of Object.entries(logsByDate)) {
      const fileName = `gate_logs_${dateStr}.csv`;
      const filePath = path.join(DAILY_CSV_DIR, fileName);
      const csvHeader = `"Log ID","Timestamp","Movement Type","Student ID","Roll Number","Student Name","Branch / Dept","Gate Name","Camera ID","Face Confidence (%)","Alert Status","Notes"\n`;
      const fileExisted = fs.existsSync(filePath);

      const rowsContent = logs.map(l => [
        escapeCsvField(l.id),
        escapeCsvField(l.log_time || l.created_at),
        escapeCsvField(l.log_type),
        escapeCsvField(l.student_id),
        escapeCsvField(l.roll_number),
        escapeCsvField(l.student_name),
        escapeCsvField(l.branch || 'General'),
        escapeCsvField(l.gate_name || 'Main Gate'),
        escapeCsvField(l.camera_id),
        escapeCsvField(l.face_confidence || '95.0'),
        escapeCsvField(l.alert_type || 'NONE'),
        escapeCsvField(l.notes || '')
      ].join(',')).join('\n') + '\n';

      if (!fileExisted) {
        fs.writeFileSync(filePath, csvHeader + rowsContent, 'utf8');
      } else {
        fs.appendFileSync(filePath, rowsContent, 'utf8');
      }

      totalArchived += logs.length;
      filesGenerated.push(fileName);
    }

    // Delete archived logs from active gate_entry_exit_logs table
    if (forceAll) {
      await dbRun("DELETE FROM gate_entry_exit_logs");
      await dbRun("DELETE FROM attendance");
    } else {
      await dbRun("DELETE FROM gate_entry_exit_logs WHERE datetime(created_at) < datetime('now', '-1 day') OR datetime(log_time) < datetime('now', '-1 day')");
      await dbRun(`DELETE FROM attendance WHERE ${attCondition}`);
    }

    console.log(`[Automated CSV Archiver] Saved ${totalArchived} logs into CSV archives (${filesGenerated.join(', ')}) and cleaned 1-day old DB entries.`);

    return {
      success: true,
      archivedCount: totalArchived,
      files: filesGenerated,
      message: `Successfully generated ${filesGenerated.length} daily CSV archive(s) and cleared database logs older than 1 day.`
    };
  } catch (err) {
    console.error('[CSV Archiver Error]:', err);
    return { success: false, message: 'Archive failed: ' + err.message };
  }
}

// POST /api/gate/trigger-archive - Manual trigger for Admin
router.post('/trigger-archive', async (req, res) => {
  try {
    const { forceAll } = req.body || {};
    const result = await archiveAndCleanupOldLogs(forceAll === true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to execute CSV archive & cleanup' });
  }
});

// GET /api/gate/csv-archives - List all available daily CSV log files
router.get('/csv-archives', (req, res) => {
  try {
    if (!fs.existsSync(DAILY_CSV_DIR)) {
      return res.json({ success: true, files: [] });
    }

    const fileNames = fs.readdirSync(DAILY_CSV_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    const filesList = fileNames.map(fileName => {
      const filePath = path.join(DAILY_CSV_DIR, fileName);
      const stat = fs.statSync(filePath);
      
      // Calculate record count by line count
      let recordCount = 0;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l.trim().length > 0);
        recordCount = Math.max(0, lines.length - 1); // Exclude header line
      } catch (e) {}

      // Extract date from filename (gate_logs_2026-10-06.csv -> 2026-10-06)
      const dateMatch = fileName.match(/\d{4}-\d{2}-\d{2}/);
      const logDate = dateMatch ? dateMatch[0] : 'Unknown Date';

      return {
        filename: fileName,
        log_date: logDate,
        size_bytes: stat.size,
        size_kb: (stat.size / 1024).toFixed(2),
        record_count: recordCount,
        created_at: stat.birthtime || stat.mtime,
        download_url: `/api/gate/download-csv/${fileName}`
      };
    });

    // Sort by log date descending
    filesList.sort((a, b) => b.log_date.localeCompare(a.log_date));

    res.json({
      success: true,
      count: filesList.length,
      files: filesList
    });
  } catch (err) {
    console.error('Error fetching CSV archives:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve CSV archives list' });
  }
});

// GET /api/gate/download-csv/:filename - Download specific daily CSV file
router.get('/download-csv/:filename', (req, res) => {
  try {
    const fileName = req.params.filename;
    
    // Prevent directory traversal attacks
    if (!fileName || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.csv')) {
      return res.status(400).send('Invalid filename request.');
    }

    const filePath = path.join(DAILY_CSV_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Requested CSV log archive file was not found.');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.sendFile(filePath);
  } catch (err) {
    console.error('CSV Download error:', err);
    res.status(500).send('Error serving CSV download');
  }
});

// Run background archiver on startup and every 30 minutes
setTimeout(() => {
  archiveAndCleanupOldLogs(false);
}, 5000);

setInterval(() => {
  archiveAndCleanupOldLogs(false);
}, 30 * 60 * 1000);

module.exports = router;

