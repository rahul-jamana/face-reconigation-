# VisioFace AI - Face Detection Attendance System 🚀

An Artificial Intelligence (AI) and Computer Vision Attendance System designed for Schools, Colleges, Offices, and Training Institutes. It recognizes registered faces, auto-marks attendance in real-time, logs entry/exit check-outs, and generates visual analytics reports with PDF, Excel, and CSV export.

---

## 🌟 Key Features

- **🔐 Dedicated Role-Based Authentication**: Separate portals for Admin, Teacher, Student, Warden, Conductor/Driver, and Security logins with password encryption (`bcryptjs`) & JWT sessions.
- **📷 7+ Mass Multi-Person Face Recognition**: Concurrent detection & bounding box recognition for 7+ people simultaneously in single camera frames using SSD MobileNet V1 & TinyFaceDetector.
- **🚌 BEC Transport Bus Tracking & AI Fleet System**: 13 transport portals including Driver Door AI Terminal, Student Bus Pass, Warden Live Telemetry, Parent Transport Hub, and automated SMS triggers for boarding, college arrival, and home stop arrival.
- **🛡️ Anti-Bypass & Security Fraud Engine**: Detects covered faces, masks, hands over face, mobile photo/screen spoofing, and tailgating with automated snapshot frame capture to Security Consoles.
- **🟢 / 🔴 Dual Scan Modes (Check-In & Check-Out)**: Supports arrival entry scanning and departure exit scanning with instant database status recording.
- **👤 Guided 30-Frame Face Enrollment Studio**: Capture 30 multi-angle face snapshot frames & store 128D AI neural embeddings.
- **📊 Analytics Dashboard**: Sky Blue & White modern UI with KPI statistics cards, 7-day attendance trend line chart, department breakdowns, and real-time live activity feed.
- **📝 Attendance Logs & Interactive Filtering**: Filter attendance records by date, department, and status (Present, Late, Check-Out, Absent) with one-click reset.
- **📁 Multi-Format Report Exports**: One-click export to **PDF**, **Excel (.xlsx)**, and **CSV**.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS (Modern Glassmorphism Theme), JavaScript (ES6+), Chart.js, SheetJS XLSX, html2pdf.js
- **Backend**: Node.js, Express.js, Cors, Multer, bcryptjs, JSONWebToken
- **Database**: Embedded SQLite (`attendance.db`)
- **AI Processing**: Client Web AI Engine + Python OpenCV (`face_engine.py`)

---

## 🚀 Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/face-detection-attendance-system.git
   cd face-detection-attendance-system
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Start the application server**:
   ```bash
   npm start
   ```

4. **Access the application**:
   Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 🔑 Default Credentials

| Role | Username | Password |
|---|---|---|
| **Admin** | `admin` | `admin123` |
| **Teacher** | `teacher` | `teacher123` |
| **Student** | `student` | `student123` |
