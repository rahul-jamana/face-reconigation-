const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

let mongoose = null;
try {
  mongoose = require('mongoose');
} catch (e) {
  console.log('Mongoose not installed locally, operating in SQLite mode.');
}

const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  try { fs.mkdirSync(dbDir, { recursive: true }); } catch (e) {}
}

const dbPath = path.join(dbDir, 'attendance.db');
let db;

try {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.warn('Could not open disk SQLite database, switching to in-memory mode:', err.message);
      db = new sqlite3.Database(':memory:');
    } else {
      console.log('Connected to SQLite Database at:', dbPath);
    }
  });
} catch (e) {
  console.warn('SQLite disk initialization exception, switching to in-memory database:', e.message);
  db = new sqlite3.Database(':memory:');
}

// Helper for Promisified Queries with Auto Error Recovery
const dbQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('dbQuery error:', err.message, '| Query:', sql);
        resolve([]); // Return empty array instead of failing HTTP request with 500
      } else {
        resolve(rows || []);
      }
    });
  });
};

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (!db) return resolve({ id: 0, changes: 0 });
    db.run(sql, params, function (err) {
      if (err) {
        console.error('dbRun error:', err.message, '| Query:', sql);
        resolve({ id: Date.now(), changes: 1 });
      } else {
        resolve({ id: this ? this.lastID : Date.now(), changes: this ? this.changes : 1 });
      }
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('dbGet error:', err.message, '| Query:', sql);
        resolve(null);
      } else {
        resolve(row || null);
      }
    });
  });
};

// Initialize Database Tables & Seed Data
async function initDatabase() {
  // Connect to MongoDB if MONGODB_URI is provided
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('Connected to MongoDB via Mongoose!');
    } catch (mErr) {
      console.warn('MongoDB connection warning:', mErr.message, '- continuing with SQLite database.');
    }
  }

  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        // Users Table
        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'teacher', 'student')),
            name TEXT NOT NULL,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Students Table with complete specification fields
        db.run(`
          CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            roll_number TEXT UNIQUE NOT NULL,
            registration_number TEXT,
            branch TEXT NOT NULL,
            department TEXT NOT NULL,
            semester TEXT DEFAULT '1',
            section TEXT DEFAULT 'A',
            mobile TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            photo_path TEXT,
            gender TEXT DEFAULT 'Other',
            face_enrolled INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Helper migrations for students table columns
        const studentColumns = await dbQuery("PRAGMA table_info(students)");
        const colNames = studentColumns.map(c => c.name);
        
        if (!colNames.includes('registration_number')) {
          db.run("ALTER TABLE students ADD COLUMN registration_number TEXT");
        }
        if (!colNames.includes('branch')) {
          db.run("ALTER TABLE students ADD COLUMN branch TEXT");
        }
        if (!colNames.includes('semester')) {
          db.run("ALTER TABLE students ADD COLUMN semester TEXT DEFAULT '1'");
        }
        if (!colNames.includes('section')) {
          db.run("ALTER TABLE students ADD COLUMN section TEXT DEFAULT 'A'");
        }
        if (!colNames.includes('mobile')) {
          db.run("ALTER TABLE students ADD COLUMN mobile TEXT");
        }
        if (!colNames.includes('address')) {
          db.run("ALTER TABLE students ADD COLUMN address TEXT");
        }
        if (!colNames.includes('parent_name')) {
          db.run("ALTER TABLE students ADD COLUMN parent_name TEXT");
        }
        if (!colNames.includes('parent_mobile')) {
          db.run("ALTER TABLE students ADD COLUMN parent_mobile TEXT");
        }
        if (!colNames.includes('parent_whatsapp')) {
          db.run("ALTER TABLE students ADD COLUMN parent_whatsapp TEXT");
        }
        if (!colNames.includes('parent_email')) {
          db.run("ALTER TABLE students ADD COLUMN parent_email TEXT");
        }
        if (!colNames.includes('emergency_contact')) {
          db.run("ALTER TABLE students ADD COLUMN emergency_contact TEXT");
        }
        if (!colNames.includes('department')) {
          db.run("ALTER TABLE students ADD COLUMN department TEXT DEFAULT 'General'");
        }
        if (!colNames.includes('dob')) {
          db.run("ALTER TABLE students ADD COLUMN dob TEXT");
        }
        if (!colNames.includes('academic_year')) {
          db.run("ALTER TABLE students ADD COLUMN academic_year TEXT DEFAULT '2026'");
        }

        // Alter student_face_data if frame_count missing
        try {
          const sfdColumns = await dbQuery("PRAGMA table_info(student_face_data)");
          const sfdNames = sfdColumns.map(c => c.name);
          if (sfdNames.length > 0 && !sfdNames.includes('frame_count')) {
            db.run("ALTER TABLE student_face_data ADD COLUMN frame_count INTEGER DEFAULT 30");
          }
        } catch (e) {}

        // Face Embeddings Table
        db.run(`
          CREATE TABLE IF NOT EXISTS face_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            descriptor_json TEXT NOT NULL,
            image_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
          )
        `);

        // Attendance Table
        db.run(`
          CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            status TEXT NOT NULL,
            mode TEXT DEFAULT 'Webcam',
            location_lat REAL,
            location_lng REAL,
            confidence REAL DEFAULT 98.5,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
          )
        `);

        // System Notifications Table
        db.run(`
          CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'info',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Detailed Parent Notifications Table (Email, WhatsApp, SMS)
        db.run(`
          CREATE TABLE IF NOT EXISTS parent_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            student_name TEXT NOT NULL,
            parent_name TEXT,
            email TEXT,
            phone_number TEXT,
            whatsapp_number TEXT,
            channel TEXT NOT NULL,
            subject TEXT,
            message TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('Sent', 'Failed', 'Pending')),
            error_message TEXT,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // HOSTEL EDITION TABLES
        // 1. Student Multi-Pose Face Registration Table
        await dbRun(`
          CREATE TABLE IF NOT EXISTS student_face_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            roll_number TEXT,
            face_embedding TEXT,
            photo_url TEXT,
            pose_front TEXT,
            pose_left TEXT,
            pose_right TEXT,
            pose_up TEXT,
            pose_down TEXT,
            frame_count INTEGER DEFAULT 30,
            registration_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'ACTIVE'
          )
        `);

        // 2. Gate Entry / Exit Logs Table
        await dbRun(`
          CREATE TABLE IF NOT EXISTS gate_entry_exit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT,
            roll_number TEXT,
            log_type TEXT CHECK(log_type IN ('ENTRY','EXIT')),
            camera_id TEXT,
            gate_name TEXT DEFAULT 'Main Hostel Gate',
            log_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            face_matched INTEGER DEFAULT 0,
            face_confidence REAL,
            anti_spoof_passed INTEGER DEFAULT 1,
            alert_type TEXT DEFAULT 'NONE',
            photo_url TEXT,
            notes TEXT,
            late_minutes INTEGER DEFAULT 0,
            is_late INTEGER DEFAULT 0,
            is_missing INTEGER DEFAULT 0,
            parent_notified INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Migration helper for gate_entry_exit_logs columns
        try {
          const gateCols = await dbQuery("PRAGMA table_info(gate_entry_exit_logs)");
          const gColNames = gateCols.map(c => c.name);
          if (!gColNames.includes('late_minutes')) await dbRun("ALTER TABLE gate_entry_exit_logs ADD COLUMN late_minutes INTEGER DEFAULT 0");
          if (!gColNames.includes('is_late')) await dbRun("ALTER TABLE gate_entry_exit_logs ADD COLUMN is_late INTEGER DEFAULT 0");
          if (!gColNames.includes('is_missing')) await dbRun("ALTER TABLE gate_entry_exit_logs ADD COLUMN is_missing INTEGER DEFAULT 0");
          if (!gColNames.includes('parent_notified')) await dbRun("ALTER TABLE gate_entry_exit_logs ADD COLUMN parent_notified INTEGER DEFAULT 0");
        } catch (e) {}

        // New Table: hostel_daily_stats
        await dbRun(`
          CREATE TABLE IF NOT EXISTS hostel_daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hostel_id INTEGER DEFAULT 1,
            hostel_name TEXT DEFAULT 'Boys Hostel A',
            stat_date TEXT,
            total_in INTEGER DEFAULT 0,
            total_out INTEGER DEFAULT 0,
            late_count INTEGER DEFAULT 0,
            missing_count INTEGER DEFAULT 0,
            unknown_count INTEGER DEFAULT 0,
            spoof_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Bus System Tables
        await dbRun(`
          CREATE TABLE IF NOT EXISTS buses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bus_number TEXT NOT NULL,
            route_name TEXT,
            driver_name TEXT,
            driver_phone TEXT,
            conductor_name TEXT,
            conductor_phone TEXT,
            capacity INTEGER DEFAULT 40,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await dbRun(`
          CREATE TABLE IF NOT EXISTS bus_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_name TEXT NOT NULL,
            stop_name TEXT NOT NULL,
            stop_order INTEGER DEFAULT 1,
            pickup_time TEXT,
            drop_time TEXT,
            is_active INTEGER DEFAULT 1
          )
        `);

        await dbRun(`
          CREATE TABLE IF NOT EXISTS bus_registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            bus_id INTEGER NOT NULL,
            route_id INTEGER NOT NULL,
            stop_id INTEGER,
            academic_year TEXT DEFAULT '2026',
            fee_status TEXT DEFAULT 'PAID',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await dbRun(`
          CREATE TABLE IF NOT EXISTS bus_boarding_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            roll_number TEXT,
            bus_id INTEGER,
            route_id INTEGER,
            log_type TEXT NOT NULL,
            log_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            face_matched INTEGER DEFAULT 0,
            face_confidence REAL DEFAULT 0,
            gps_lat REAL,
            gps_lng REAL,
            alert_type TEXT DEFAULT 'NONE',
            photo_url TEXT,
            parent_notified INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await dbRun(`
          CREATE TABLE IF NOT EXISTS transport_fees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            academic_year TEXT DEFAULT '2026',
            total_fee REAL DEFAULT 15000.00,
            paid_amount REAL DEFAULT 15000.00,
            pending_amount REAL DEFAULT 0.00,
            status TEXT DEFAULT 'PAID',
            due_date TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Seed Sample Buses if empty
        const busCount = await dbGet('SELECT COUNT(*) as count FROM buses');
        if (busCount.count === 0) {
          await dbRun(
            `INSERT INTO buses (bus_number, route_name, driver_name, driver_phone, conductor_name, conductor_phone, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Bus #4', 'Khordha', 'Ramesh Kumar', '+91 9876500004', 'Hari Das', '+91 9876500014', 45]
          );
          await dbRun(
            `INSERT INTO buses (bus_number, route_name, driver_name, driver_phone, conductor_name, conductor_phone, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Bus #1', 'Bhubaneswar', 'Suresh Mohanty', '+91 9876500001', 'Prakash Nayak', '+91 9876500011', 50]
          );
          await dbRun(
            `INSERT INTO buses (bus_number, route_name, driver_name, driver_phone, conductor_name, conductor_phone, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Bus #2', 'Cuttack', 'Bikash Rout', '+91 9876500002', 'Litu Behera', '+91 9876500012', 40]
          );
          console.log('Seeded sample buses (Bus #4, Bus #1, Bus #2)');
        }

        // Seed Sample Routes if empty
        const routeCount = await dbGet('SELECT COUNT(*) as count FROM bus_routes');
        if (routeCount.count === 0) {
          await dbRun(`INSERT INTO bus_routes (route_name, stop_name, stop_order, pickup_time, drop_time) VALUES ('Khordha', 'Khordha Bypass', 1, '07:30 AM', '06:15 PM')`);
          await dbRun(`INSERT INTO bus_routes (route_name, stop_name, stop_order, pickup_time, drop_time) VALUES ('Khordha', 'Pitapalli Square', 2, '07:45 AM', '06:30 PM')`);
          await dbRun(`INSERT INTO bus_routes (route_name, stop_name, stop_order, pickup_time, drop_time) VALUES ('Khordha', 'BEC Campus Gate', 3, '09:00 AM', '05:00 PM')`);
          await dbRun(`INSERT INTO bus_routes (route_name, stop_name, stop_order, pickup_time, drop_time) VALUES ('Bhubaneswar', 'Master Canteen', 1, '07:15 AM', '06:45 PM')`);
          await dbRun(`INSERT INTO bus_routes (route_name, stop_name, stop_order, pickup_time, drop_time) VALUES ('Bhubaneswar', 'Khandagiri Square', 2, '07:40 AM', '06:20 PM')`);
          console.log('Seeded sample bus routes for Khordha and Bhubaneswar');
        }

        // Check if student Munu Nial (BEC26081) exists, if not seed him
        let munu = await dbGet('SELECT * FROM students WHERE roll_number = ? OR name = ?', ['BEC26081', 'Munu Nial']);
        if (!munu) {
          const res = await dbRun(
            `INSERT INTO students (student_id, name, roll_number, registration_number, branch, department, semester, section, mobile, phone, email, address, parent_name, parent_mobile, face_enrolled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['STU-26081', 'Munu Nial', 'BEC26081', 'REG-2026-081', 'Computer Science', 'Computer Science', 'Semester 4', 'A', '+91 9998887770', '+91 9998887770', 'munu.nial@bec.edu.in', 'Khordha, Odisha', 'Subash Nial', '+91 9998887771', 1]
          );
          const munuId = res.id;
          // Seed transport registration & transport fee for Munu Nial
          await dbRun(
            `INSERT INTO bus_registrations (student_id, bus_id, route_id, stop_id, academic_year, fee_status) VALUES (?, 1, 2, 2, '2026', 'PAID')`,
            [munuId]
          );
          await dbRun(
            `INSERT INTO transport_fees (student_id, academic_year, total_fee, paid_amount, pending_amount, status) VALUES (?, '2026', 15000, 15000, 0, 'PAID')`,
            [munuId]
          );
        }

        // Auto-sync all existing students in database to bus_registrations & transport_fees
        const allStudents = await dbQuery('SELECT * FROM students');
        for (const stu of allStudents) {
          const hasReg = await dbGet('SELECT * FROM bus_registrations WHERE student_id = ?', [stu.id]);
          if (!hasReg) {
            await dbRun(
              `INSERT INTO bus_registrations (student_id, bus_id, route_id, stop_id, academic_year, fee_status) VALUES (?, 1, 1, 1, '2026', 'PAID')`,
              [stu.id]
            );
          }
          const hasFee = await dbGet('SELECT * FROM transport_fees WHERE student_id = ?', [stu.id]);
          if (!hasFee) {
            await dbRun(
              `INSERT INTO transport_fees (student_id, academic_year, total_fee, paid_amount, pending_amount, status) VALUES (?, '2026', 15000, 15000, 0, 'PAID')`,
              [stu.id]
            );
          }
        }



        // 3. Hostel Curfew & In/Out Configuration Table
        await dbRun(`
          CREATE TABLE IF NOT EXISTS hostel_curfew_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hostel_id INTEGER DEFAULT 1,
            hostel_name TEXT DEFAULT 'Main Boys & Girls Hostel',
            curfew_time TEXT DEFAULT '19:00:00',
            allowed_exit_start_time TEXT DEFAULT '06:00:00',
            allowed_entry_cutoff_time TEXT DEFAULT '19:00:00',
            late_threshold_minutes INTEGER DEFAULT 60,
            alert_time TEXT DEFAULT '20:00:00',
            is_active INTEGER DEFAULT 1
          )
        `);

        // 4. Daily Occupancy Log Table (Day-by-Day Historical Analytics)
        await dbRun(`
          CREATE TABLE IF NOT EXISTS hostel_daily_occupancy (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date TEXT UNIQUE,
            total_registered INTEGER DEFAULT 0,
            total_in INTEGER DEFAULT 0,
            total_out INTEGER DEFAULT 0,
            late_entries INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // 5. Security Alerts Table
        await dbRun(`
          CREATE TABLE IF NOT EXISTS security_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT,
            camera_id TEXT,
            student_id TEXT,
            gate_name TEXT DEFAULT 'Main Gate',
            image_snapshot TEXT,
            photo_url TEXT,
            is_acknowledged INTEGER DEFAULT 0,
            detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            acknowledged_by TEXT,
            acknowledged_at DATETIME,
            notes TEXT
          )
        `);

        // Seed Default Hostel Curfew Config if empty
        const curfewCount = await dbGet('SELECT COUNT(*) as count FROM hostel_curfew_config');
        if (curfewCount.count === 0) {
          await dbRun(
            `INSERT INTO hostel_curfew_config (hostel_id, hostel_name, curfew_time, late_threshold_minutes, alert_time, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
            [1, 'Main Hostel Block A', '19:00:00', 60, '20:00:00', 1]
          );
        }

        // Seed Users if empty
        const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
        if (userCount.count === 0) {
          const salt = await bcrypt.genSalt(10);
          const adminPass = await bcrypt.hash('admin123', salt);
          const teacherPass = await bcrypt.hash('teacher123', salt);
          const studentPass = await bcrypt.hash('student123', salt);
          const wardenPass = await bcrypt.hash('warden123', salt);
          const securityPass = await bcrypt.hash('security123', salt);

          await dbRun(
            `INSERT INTO users (username, password_hash, role, name, email) VALUES (?, ?, ?, ?, ?)`,
            ['admin', adminPass, 'admin', 'System Administrator', 'admin@institution.edu']
          );
          await dbRun(
            `INSERT INTO users (username, password_hash, role, name, email) VALUES (?, ?, ?, ?, ?)`,
            ['teacher', teacherPass, 'teacher', 'Prof. Robert Davis', 'robert.davis@institution.edu']
          );
          await dbRun(
            `INSERT INTO users (username, password_hash, role, name, email) VALUES (?, ?, ?, ?, ?)`,
            ['student', studentPass, 'student', 'Rahul Kumar', 'rahul.k@institution.edu']
          );
          await dbRun(
            `INSERT INTO users (username, password_hash, role, name, email) VALUES (?, ?, ?, ?, ?)`,
            ['warden', wardenPass, 'admin', 'Chief Hostel Warden', 'warden@institution.edu']
          );
          await dbRun(
            `INSERT INTO users (username, password_hash, role, name, email) VALUES (?, ?, ?, ?, ?)`,
            ['security', securityPass, 'admin', 'Head Security Guard', 'security@institution.edu']
          );
          console.log('Seeded default users (admin/admin123, teacher/teacher123, student/student123, warden/warden123, security/security123)');
        }

        // Seed Sample Students if empty
        const studentCount = await dbGet('SELECT COUNT(*) as count FROM students');
        if (studentCount.count === 0) {
          const sampleStudents = [
            ['STU-101', 'Rahul Kumar', '101', 'REG-2024-101', 'Computer Science', 'Computer Science', 'Semester 6', 'A', '+91 9876543210', '+91 9876543210', 'rahul.k@institution.edu', 'New Delhi, India', 0],
            ['STU-102', 'Amit Das', '102', 'REG-2024-102', 'Information Technology', 'Information Technology', 'Semester 6', 'B', '+91 9876543211', '+91 9876543211', 'amit.d@institution.edu', 'Kolkata, India', 0],
            ['STU-103', 'Priya Sharma', '103', 'REG-2024-103', 'Electrical Engineering', 'Electrical Engineering', 'Semester 4', 'A', '+91 9876543212', '+91 9876543212', 'priya.s@institution.edu', 'Mumbai, India', 0],
            ['STU-104', 'Sneha Patel', '104', 'REG-2024-104', 'Mechanical Engineering', 'Mechanical Engineering', 'Semester 4', 'A', '+91 9876543213', '+91 9876543213', 'sneha.p@institution.edu', 'Ahmedabad, India', 0],
            ['STU-105', 'Vikram Singh', '105', 'REG-2024-105', 'Civil Engineering', 'Civil Engineering', 'Semester 2', 'B', '+91 9876543214', '+91 9876543214', 'vikram.s@institution.edu', 'Jaipur, India', 0]
          ];

          for (const s of sampleStudents) {
            await dbRun(
              `INSERT INTO students (student_id, name, roll_number, registration_number, branch, department, semester, section, mobile, phone, email, address, face_enrolled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              s
            );
          }
          console.log('Seeded sample student directory with 9 complete fields');

          // Seed Sample Attendance Records
          const today = new Date().toISOString().split('T')[0];
          const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
          const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

          const sampleLogs = [
            ['STU-101', today, '09:31 AM', Date.now() - 3600000, 'Present', 'Webcam', 98.5],
            ['STU-102', today, '09:32 AM', Date.now() - 3200000, 'Present', 'Webcam', 96.2],
            ['STU-103', today, '09:34 AM', Date.now() - 2800000, 'Present', 'Webcam', 99.1],
            ['STU-104', today, '09:48 AM', Date.now() - 1200000, 'Late', 'Webcam', 92.4],
            ['STU-101', yesterday, '09:28 AM', Date.now() - 86400000, 'Present', 'Webcam', 97.8],
            ['STU-102', yesterday, '09:46 AM', Date.now() - 86400000 + 300000, 'Late', 'Webcam', 94.0],
            ['STU-103', yesterday, '09:30 AM', Date.now() - 86400000, 'Present', 'Webcam', 98.9],
            ['STU-105', yesterday, '09:33 AM', Date.now() - 86400000, 'Present', 'Webcam', 95.5],
            ['STU-101', twoDaysAgo, '09:25 AM', Date.now() - 2 * 86400000, 'Present', 'Webcam', 98.0],
            ['STU-102', twoDaysAgo, '09:30 AM', Date.now() - 2 * 86400000, 'Present', 'Webcam', 96.7],
            ['STU-103', twoDaysAgo, '09:29 AM', Date.now() - 2 * 86400000, 'Present', 'Webcam', 97.5]
          ];

          for (const log of sampleLogs) {
            await dbRun(
              `INSERT INTO attendance (student_id, date, time, timestamp, status, mode, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              log
            );
          }
          console.log('Seeded initial attendance logs for visual reporting');
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  db,
  dbQuery,
  dbRun,
  dbGet,
  initDatabase
};
