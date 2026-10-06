const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { dbQuery, dbGet, dbRun } = require('../db/database');

let StudentModel = null;
try {
  StudentModel = require('../models/Student');
} catch (e) {}

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'faces');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// POST /api/face/enroll - Store 5-pose face descriptors, image gallery & metadata
router.post('/enroll', async (req, res) => {
  try {
    const { 
      student_id, studentId,
      name, 
      roll_number, rollNumber,
      registration_number, registrationNumber,
      branch, department,
      semester,
      section,
      mobile, phone,
      email,
      address,
      parent_name, parentName,
      parent_mobile, parentMobile,
      parent_whatsapp, parentWhatsapp,
      parent_email, parentEmail,
      descriptors, 
      sample_images, // Array of base64 images (poses 1 to 5)
      sample_image_base64,
      mark_attendance 
    } = req.body;

    const sId = studentId || student_id;
    const rNum = rollNumber || roll_number;
    const regNum = registrationNumber || registration_number;
    const bName = branch || department;
    const pName = parentName || parent_name || '';
    const pMob = parentMobile || parent_mobile || '';
    const pWhatsapp = parentWhatsapp || parent_whatsapp || pMob || '';
    const pEmail = parentEmail || parent_email || '';

    if (!sId || !descriptors || !Array.isArray(descriptors) || descriptors.length === 0) {
      return res.status(400).json({ success: false, message: 'Student ID and face descriptors are required.' });
    }

    // 1. Create dedicated folder: /uploads/faces/<sId>/
    const studentDir = path.join(UPLOADS_DIR, sId);
    if (!fs.existsSync(studentDir)) {
      fs.mkdirSync(studentDir, { recursive: true });
    }

    // 2. Save pose photos to disk
    const savedPhotoPaths = [];
    const imagesToProcess = sample_images && Array.isArray(sample_images) ? sample_images : (sample_image_base64 ? [sample_image_base64] : []);
    
    imagesToProcess.forEach((base64Img, idx) => {
      if (base64Img) {
        const base64Data = base64Img.replace(/^data:image\/\w+;base64,/, '');
        const fileName = `pose_${idx + 1}_${Date.now()}.jpg`;
        const relativePath = path.join('uploads', 'faces', sId, fileName).replace(/\\/g, '/');
        const fullPath = path.join(__dirname, '..', relativePath);
        fs.writeFileSync(fullPath, base64Data, { encoding: 'base64' });
        savedPhotoPaths.push(relativePath);
      }
    });

    const mainPhotoPath = savedPhotoPaths[0] || '';

    // 3. Save to MongoDB if available
    if (process.env.MONGODB_URI) {
      let student = await StudentModel.findOne({ $or: [{ studentId: sId }, { rollNumber: rNum }] });
      if (!student) {
        student = await StudentModel.create({
          studentId: sId,
          name: name || sId,
          rollNumber: rNum || sId,
          registrationNumber: regNum || `REG-${rNum}`,
          branch: bName || 'Computer Science',
          semester: semester || '1',
          section: section || 'A',
          mobile: mobile || phone || '',
          email: email || '',
          address: address || '',
          parentName: pName,
          parentMobile: pMob,
          parentWhatsapp: pWhatsapp,
          parentEmail: pEmail,
          photoPath: mainPhotoPath,
          posePhotos: savedPhotoPaths,
          faceEncoding: descriptors[0] || [],
          descriptors: descriptors,
          faceEnrolled: true
        });
      } else {
        student.photoPath = mainPhotoPath || student.photoPath;
        student.posePhotos = savedPhotoPaths.length > 0 ? savedPhotoPaths : student.posePhotos;
        student.faceEncoding = descriptors[0] || student.faceEncoding;
        student.descriptors = descriptors;
        student.parentName = pName || student.parentName;
        student.parentMobile = pMob || student.parentMobile;
        student.parentWhatsapp = pWhatsapp || student.parentWhatsapp;
        student.parentEmail = pEmail || student.parentEmail;
        student.faceEnrolled = true;
        await student.save();
      }

      return res.json({
        success: true,
        message: `Face descriptors enrolled successfully for ${student.name}`,
        student,
        photoPath: mainPhotoPath
      });
    }

    // 4. SQLite Storage Fallback
    let student = await dbGet('SELECT * FROM students WHERE student_id = ? OR roll_number = ?', [sId, rNum]);
    if (!student) {
      const sResult = await dbRun(
        `INSERT INTO students (student_id, name, roll_number, registration_number, branch, department, semester, section, mobile, phone, email, address, photo_path, parent_name, parent_mobile, parent_whatsapp, parent_email, face_enrolled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [sId, name || sId, rNum || sId, regNum || `REG-${rNum}`, bName || 'General', bName || 'General', semester || '1', section || 'A', mobile || phone || '', mobile || phone || '', email || '', address || '', mainPhotoPath, pName, pMob, pWhatsapp, pEmail]
      );
      student = { id: sResult.id, student_id: sId, name, roll_number: rNum, branch: bName, photo_path: mainPhotoPath, parent_name: pName, parent_mobile: pMob, parent_whatsapp: pWhatsapp, parent_email: pEmail };
    } else {
      await dbRun(
        `UPDATE students SET face_enrolled = 1, photo_path = ?, parent_name = COALESCE(NULLIF(?, ''), parent_name), parent_mobile = COALESCE(NULLIF(?, ''), parent_mobile), parent_whatsapp = COALESCE(NULLIF(?, ''), parent_whatsapp), parent_email = COALESCE(NULLIF(?, ''), parent_email) WHERE id = ?`,
        [mainPhotoPath || student.photo_path, pName, pMob, pWhatsapp, pEmail, student.id]
      );
      student.parent_name = pName || student.parent_name;
      student.parent_mobile = pMob || student.parent_mobile;
      student.parent_whatsapp = pWhatsapp || student.parent_whatsapp;
      student.parent_email = pEmail || student.parent_email;
    }

    // Clear old embeddings for re-enrollment
    await dbRun('DELETE FROM face_embeddings WHERE student_id = ?', [sId]);

    // Insert new descriptors
    for (const desc of descriptors) {
      const descJson = typeof desc === 'string' ? desc : JSON.stringify(desc);
      await dbRun(
        `INSERT INTO face_embeddings (student_id, descriptor_json, image_path) VALUES (?, ?, ?)`,
        [sId, descJson, mainPhotoPath]
      );
    }

    // Auto-sync enrolled student 30-frame face data to Bus System & Transport Fee Records
    try {
      const existingBusReg = await dbGet('SELECT * FROM bus_registrations WHERE student_id = ?', [student.id]);
      if (!existingBusReg) {
        await dbRun(
          `INSERT INTO bus_registrations (student_id, bus_id, route_id, stop_id, academic_year, fee_status) VALUES (?, 1, 1, 1, '2026', 'PAID')`,
          [student.id]
        );
      }
      const existingFee = await dbGet('SELECT * FROM transport_fees WHERE student_id = ?', [student.id]);
      if (!existingFee) {
        await dbRun(
          `INSERT INTO transport_fees (student_id, academic_year, total_fee, paid_amount, pending_amount, status) VALUES (?, '2026', 15000, 15000, 0, 'PAID')`,
          [student.id]
        );
      }
    } catch (bErr) {
      console.warn('Bus auto-sync error:', bErr.message);
    }

    res.json({
      success: true,
      message: `Face descriptors registered for ${student.name} and synced to Bus System!`,
      student_id: sId,
      photoPath: mainPhotoPath,
      samples_saved: descriptors.length
    });
  } catch (err) {
    console.error('Error in /api/face/enroll:', err);
    res.status(500).json({ success: false, message: 'Server error enrolling face encodings' });
  }
});

// GET /api/face/descriptors - Retrieve all enrolled student face encodings for matching
router.get('/descriptors', async (req, res) => {
  try {
    if (process.env.MONGODB_URI) {
      const students = await StudentModel.find({ faceEnrolled: true });
      const enrolled_students = students.map(s => ({
        student_id: s.studentId,
        studentId: s.studentId,
        name: s.name,
        roll_number: s.rollNumber,
        rollNumber: s.rollNumber,
        branch: s.branch,
        semester: s.semester,
        photo_path: s.photoPath,
        descriptors: s.descriptors || [s.faceEncoding]
      }));
      return res.json({ success: true, count: enrolled_students.length, enrolled_students });
    }

    // SQLite Fallback
    const students = await dbQuery('SELECT * FROM students WHERE face_enrolled = 1');
    const enrolled_students = [];

    for (const student of students) {
      const embeddings = await dbQuery(
        'SELECT descriptor_json FROM face_embeddings WHERE student_id = ?',
        [student.student_id]
      );

      const parsedDescriptors = [];
      for (const emb of embeddings) {
        try {
          const arr = JSON.parse(emb.descriptor_json);
          if (Array.isArray(arr)) parsedDescriptors.push(arr);
        } catch (e) {}
      }

      if (parsedDescriptors.length > 0) {
        enrolled_students.push({
          student_id: student.student_id,
          studentId: student.student_id,
          name: student.name,
          roll_number: student.roll_number,
          rollNumber: student.roll_number,
          branch: student.branch || student.department,
          semester: student.semester || '1',
          photo_path: student.photo_path || '',
          descriptors: parsedDescriptors
        });
      }
    }

    res.json({ success: true, count: enrolled_students.length, enrolled_students });
  } catch (err) {
    console.error('Error loading descriptors:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve face descriptors' });
  }
});

module.exports = router;
