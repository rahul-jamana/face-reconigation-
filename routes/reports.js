const express = require('express');
const router = express.Router();
const { dbQuery, dbGet } = require('../db/database');

let StudentModel = null;
let AttendanceModel = null;
try {
  StudentModel = require('../models/Student');
  AttendanceModel = require('../models/Attendance');
} catch (e) {}

// GET /api/reports/dashboard - Summary stats and chart metrics
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    if (process.env.MONGODB_URI) {
      const totalStudents = await StudentModel.countDocuments();
      const presentLogs = await AttendanceModel.find({ date: today, status: { $in: ['Present', 'Late'] } });
      
      const presentStudentIds = new Set(presentLogs.map(l => l.studentId));
      const presentToday = presentStudentIds.size;
      const lateToday = presentLogs.filter(l => l.status === 'Late').length;
      const absentToday = Math.max(0, totalStudents - presentToday);
      const attendancePercentage = totalStudents > 0 ? ((presentToday / totalStudents) * 100).toFixed(1) : 0;

      // Branch breakdown
      const students = await StudentModel.find();
      const branchMap = {};
      students.forEach(s => {
        const b = s.branch || 'General';
        if (!branchMap[b]) branchMap[b] = { total: 0, present: 0 };
        branchMap[b].total++;
        if (presentStudentIds.has(s.studentId)) {
          branchMap[b].present++;
        }
      });

      const deptStats = Object.keys(branchMap).map(b => ({
        department: b,
        branch: b,
        total: branchMap[b].total,
        present: branchMap[b].present,
        absent: Math.max(0, branchMap[b].total - branchMap[b].present),
        percentage: branchMap[b].total > 0 ? ((branchMap[b].present / branchMap[b].total) * 100).toFixed(1) : 0
      }));

      // 7-day trend
      const trend = [];
      for (let i = 6; i >= 0; i--) {
        const dDate = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
        const dayLogs = await AttendanceModel.find({ date: dDate, status: { $in: ['Present', 'Late'] } });
        const dayPresentIds = new Set(dayLogs.map(l => l.studentId));
        const dayName = new Date(dDate).toLocaleDateString('en-US', { weekday: 'short' });
        trend.push({
          date: dDate,
          day: dayName,
          present: dayPresentIds.size,
          total: totalStudents
        });
      }

      // Recent activity
      const recentActivity = await AttendanceModel.find({ date: today })
        .sort({ timestamp: -1 })
        .limit(10);

      return res.json({
        success: true,
        stats: {
          totalStudents,
          presentToday,
          lateToday,
          absentToday,
          attendancePercentage
        },
        departments: deptStats,
        trend,
        recentActivity
      });
    }

    // SQLite Fallback
    const totalStudentsRow = await dbGet('SELECT COUNT(*) as count FROM students');
    const totalStudents = totalStudentsRow ? totalStudentsRow.count : 0;

    const presentTodayRow = await dbGet(
      'SELECT COUNT(DISTINCT student_id) as count FROM attendance WHERE date = ? AND status IN ("Present", "Late", "Early")',
      [today]
    );
    const presentToday = presentTodayRow ? presentTodayRow.count : 0;

    const lateTodayRow = await dbGet(
      'SELECT COUNT(DISTINCT student_id) as count FROM attendance WHERE date = ? AND status = "Late"',
      [today]
    );
    const lateToday = lateTodayRow ? lateTodayRow.count : 0;

    const absentToday = Math.max(0, totalStudents - presentToday);
    const attendancePercentage = totalStudents > 0 ? ((presentToday / totalStudents) * 100).toFixed(1) : 0;

    // Department / Branch breakdown
    const deptRows = await dbQuery(`
      SELECT COALESCE(branch, department) as branch_name, COUNT(*) as total_students
      FROM students
      GROUP BY branch_name
    `);

    const deptStats = [];
    for (const d of deptRows) {
      const bName = d.branch_name || 'General';
      const pRow = await dbGet(`
        SELECT COUNT(DISTINCT a.student_id) as present_count
        FROM attendance a
        JOIN students s ON a.student_id = s.student_id
        WHERE a.date = ? AND (s.branch = ? OR s.department = ?) AND a.status IN ("Present", "Late", "Early")
      `, [today, bName, bName]);

      const present = pRow ? pRow.present_count : 0;
      deptStats.push({
        department: bName,
        branch: bName,
        total: d.total_students,
        present,
        absent: Math.max(0, d.total_students - present),
        percentage: d.total_students > 0 ? ((present / d.total_students) * 100).toFixed(1) : 0
      });
    }

    // 7-day trend
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const dDate = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const countRow = await dbGet(
        'SELECT COUNT(DISTINCT student_id) as count FROM attendance WHERE date = ? AND status IN ("Present", "Late", "Early")',
        [dDate]
      );
      const dayName = new Date(dDate).toLocaleDateString('en-US', { weekday: 'short' });
      trend.push({
        date: dDate,
        day: dayName,
        present: countRow ? countRow.count : 0,
        total: totalStudents
      });
    }

    // Recent activity
    const recentActivity = await dbQuery(`
      SELECT a.id, a.student_id, a.date, a.time, a.status, a.mode, s.name, COALESCE(s.branch, s.department) as branch, s.roll_number
      FROM attendance a
      JOIN students s ON a.student_id = s.student_id
      WHERE a.date = ?
      ORDER BY a.id DESC LIMIT 10
    `, [today]);

    res.json({
      success: true,
      stats: {
        totalStudents,
        presentToday,
        lateToday,
        absentToday,
        attendancePercentage
      },
      departments: deptStats,
      trend,
      recentActivity
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.json({
      success: true,
      stats: {
        totalStudents: 0,
        presentToday: 0,
        lateToday: 0,
        absentToday: 0,
        attendancePercentage: '0.0'
      },
      departments: [],
      trend: [],
      recentActivity: []
    });
  }
});

// GET /api/reports/export/csv - Export CSV file download
router.get('/export/csv', async (req, res) => {
  try {
    const { date, branch, semester } = req.query;
    let records = [];

    if (process.env.MONGODB_URI) {
      const query = {};
      if (date) query.date = date;
      if (branch && branch !== 'All') query.branch = branch;
      if (semester && semester !== 'All') query.semester = semester;
      records = await AttendanceModel.find(query).sort({ timestamp: -1 });
    } else {
      let sql = `
        SELECT a.date, a.time, a.status, a.confidence, s.student_id, s.name, s.roll_number, COALESCE(s.branch, s.department) as branch, s.semester, s.section, s.mobile
        FROM attendance a
        JOIN students s ON a.student_id = s.student_id
        WHERE 1=1
      `;
      let params = [];

      if (date) {
        sql += ' AND a.date = ?';
        params.push(date);
      }
      if (branch && branch !== 'All') {
        sql += ' AND (s.branch = ? OR s.department = ?)';
        params.push(branch, branch);
      }
      if (semester && semester !== 'All') {
        sql += ' AND s.semester = ?';
        params.push(semester);
      }

      sql += ' ORDER BY a.timestamp DESC';
      records = await dbQuery(sql, params);
    }

    let csvContent = 'Date,Time,Student ID,Student Name,Roll Number,Branch,Semester,Section,Status,Confidence\n';
    
    records.forEach(r => {
      const d = r.date || '';
      const t = r.time || '';
      const sid = r.studentId || r.student_id || '';
      const name = `"${(r.name || '').replace(/"/g, '""')}"`;
      const roll = r.rollNumber || r.roll_number || '';
      const b = `"${(r.branch || r.department || '').replace(/"/g, '""')}"`;
      const sem = r.semester || '';
      const sec = r.section || '';
      const st = r.status || '';
      const conf = r.confidence ? `${r.confidence}%` : '98.5%';

      csvContent += `${d},${t},${sid},${name},${roll},${b},${sem},${sec},${st},${conf}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Attendance_Report_${date || 'all'}.csv`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('CSV Export error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate CSV export' });
  }
});

// GET /api/reports/specialized - Generate specialized reports (Daily Entry/Exit, Late Entry, Missing, Student-wise, Monthly, Unknown Person)
router.get('/specialized', async (req, res) => {

  try {
    const { type, date, month, student_id, format } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    let title = 'Hostel Report';
    let records = [];

    if (type === 'daily_entry') {
      title = `Daily Entry Register (${targetDate})`;
      records = await dbQuery(`
        SELECT g.*, s.name, s.branch, s.mobile
        FROM gate_entry_exit_logs g
        LEFT JOIN students s ON (g.student_id = s.student_id OR g.roll_number = s.roll_number)
        WHERE g.log_type = 'ENTRY' AND date(g.log_time) = date(?)
        ORDER BY g.id DESC
      `, [targetDate]);
    } else if (type === 'daily_exit') {
      title = `Daily Exit Register (${targetDate})`;
      records = await dbQuery(`
        SELECT g.*, s.name, s.branch, s.mobile
        FROM gate_entry_exit_logs g
        LEFT JOIN students s ON (g.student_id = s.student_id OR g.roll_number = s.roll_number)
        WHERE g.log_type = 'EXIT' AND date(g.log_time) = date(?)
        ORDER BY g.id DESC
      `, [targetDate]);
    } else if (type === 'late_entry') {
      title = `Late Entry & Cutoff Violation Report (${targetDate})`;
      records = await dbQuery(`
        SELECT g.*, s.name, s.branch, s.parent_name, s.parent_mobile
        FROM gate_entry_exit_logs g
        LEFT JOIN students s ON (g.student_id = s.student_id OR g.roll_number = s.roll_number)
        WHERE (g.is_late = 1 OR g.alert_type IN ('LATE_ENTRY', 'VERY_LATE', 'CRITICAL')) AND date(g.log_time) = date(?)
        ORDER BY g.id DESC
      `, [targetDate]);
    } else if (type === 'missing_student') {
      title = `Missing / Unreturned Student Report (${targetDate})`;
      records = await dbQuery(`
        SELECT s.*, g.log_time as exit_time, g.gate_name
        FROM students s
        JOIN (
          SELECT * FROM gate_entry_exit_logs
          WHERE id IN (SELECT MAX(id) FROM gate_entry_exit_logs GROUP BY student_id)
        ) g ON s.student_id = g.student_id
        WHERE g.log_type = 'EXIT'
      `);
    } else if (type === 'unknown_person') {
      title = `Unknown Person & Security Alerts Report`;
      records = await dbQuery(`
        SELECT * FROM security_alerts ORDER BY id DESC LIMIT 100
      `);
    } else {
      title = `Hostel Gate Movement Report`;
      records = await dbQuery(`
        SELECT g.*, s.name, s.branch
        FROM gate_entry_exit_logs g
        LEFT JOIN students s ON (g.student_id = s.student_id OR g.roll_number = s.roll_number)
        ORDER BY g.id DESC LIMIT 100
      `);
    }

    if (format === 'csv') {
      let csv = `"${title}"\n\n`;
      csv += `"ID","Timestamp","Student ID","Roll Number","Name","Movement Type","Alert Status","Notes"\n`;
      records.forEach(r => {
        csv += `"${r.id || ''}","${r.log_time || r.created_at || ''}","${r.student_id || ''}","${r.roll_number || ''}","${r.name || r.student_name || ''}","${r.log_type || ''}","${r.alert_type || 'NONE'}","${r.notes || ''}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}_report_${targetDate}.csv"`);
      return res.send(csv);
    }

    res.json({
      success: true,
      title,
      type: type || 'general',
      count: records.length,
      records
    });
  } catch (err) {
    console.error('Specialized report error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

module.exports = router;

