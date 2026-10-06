const express = require('express');
const router = express.Router();
const { dbQuery, dbGet, dbRun } = require('../db/database');

// GET /api/transport-fees/:student_id - Check Transport Fee Payment Status & Unpaid Alerts
router.get('/:student_id', async (req, res) => {
  try {
    const studentId = req.params.student_id;
    let fee = await dbGet('SELECT tf.*, s.name as student_name, s.roll_number FROM transport_fees tf JOIN students s ON tf.student_id = s.id WHERE tf.student_id = ? OR s.roll_number = ? OR s.student_id = ? OR s.id = ?', [studentId, studentId, studentId, studentId]);

    if (!fee) {
      // Check if student exists by ID, roll_number, or student_id string
      const student = await dbGet('SELECT * FROM students WHERE id = ? OR roll_number = ? OR student_id = ?', [studentId, studentId, studentId]);
      if (student) {
        // Create default record
        await dbRun(
          `INSERT INTO transport_fees (student_id, academic_year, total_fee, paid_amount, pending_amount, status) VALUES (?, '2026', 15000, 15000, 0, 'PAID')`,
          [student.id]
        );
        fee = { student_id: student.id, student_name: student.name, roll_number: student.roll_number, academic_year: '2026', total_fee: 15000, paid_amount: 15000, pending_amount: 0, status: 'PAID' };
      } else {
        return res.status(404).json({ success: false, message: 'Student transport fee record not found' });
      }
    }

    res.json({ success: true, fee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/transport-fees/:student_id - Update fee status
router.put('/:student_id', async (req, res) => {
  try {
    const studentId = req.params.student_id;
    const { status, paid_amount, pending_amount, total_fee = 15000 } = req.body;

    const student = await dbGet('SELECT * FROM students WHERE id = ? OR roll_number = ?', [studentId, studentId]);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    await dbRun(
      `UPDATE transport_fees SET status = ?, paid_amount = ?, pending_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
      [status, paid_amount, pending_amount, student.id]
    );

    // Also update bus_registrations table status
    await dbRun(
      `UPDATE bus_registrations SET fee_status = ? WHERE student_id = ?`,
      [status, student.id]
    );

    res.json({ success: true, message: `✔ Transport fee status updated to ${status} for ${student.name}!` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/transport-fees - List all transport fee records
router.get('/', async (req, res) => {
  try {
    const list = await dbQuery(
      `SELECT tf.*, s.name as student_name, s.roll_number, s.branch
       FROM transport_fees tf
       JOIN students s ON tf.student_id = s.id
       ORDER BY tf.status DESC, s.name ASC`
    );
    res.json({ success: true, count: list.length, fees: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
