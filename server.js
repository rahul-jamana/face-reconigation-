const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const os = require('os');
const { initDatabase } = require('./db/database');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helper function to extract machine's local IPv4 network addresses (prioritizing Wi-Fi & LAN)
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        list.push({ name, address: iface.address });
      }
    }
  }
  list.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName.includes('wi-fi') || aName.includes('wifi') || aName.includes('wireless')) return -1;
    if (bName.includes('wi-fi') || bName.includes('wifi') || bName.includes('wireless')) return 1;
    if (a.address.startsWith('10.') || a.address.startsWith('192.168.')) return -1;
    if (b.address.startsWith('10.') || b.address.startsWith('192.168.')) return 1;
    return 0;
  });
  const addrs = list.map(item => item.address);
  return addrs.length > 0 ? addrs : ['127.0.0.1'];
}

function getLocalIpAddress() {
  return getLocalIpAddresses()[0];
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static Asset Directories
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/gate_logs', express.static(path.join(__dirname, 'uploads', 'gate_logs')));
app.use('/uploads/daily_csv_logs', express.static(path.join(__dirname, 'uploads', 'daily_csv_logs')));

// Routes
const { router: authRoutes } = require('./routes/auth');
const studentRoutes = require('./routes/students');
const faceRoutes = require('./routes/face');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes = require('./routes/reports');
const { router: notificationRoutes } = require('./routes/notifications');
const gateRoutes = require('./routes/gate');
const wardenRoutes = require('./routes/warden');
const securityRoutes = require('./routes/security');
const busRoutes = require('./routes/bus');
const transportFeeRoutes = require('./routes/transport-fees');

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/face', faceRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/gate', gateRoutes);
app.use('/api/warden', wardenRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/bus', busRoutes);
app.use('/api/transport-fees', transportFeeRoutes);

// Explicit UI Page Routes for Clean URLs
const uiRoutes = [
  '/student/bus-pass',
  '/student/bus-log',
  '/parent/ward-transport',
  '/warden/bus-live',
  '/warden/bus-register',
  '/admin/buses',
  '/admin/bus-routes',
  '/admin/bus-registrations',
  '/admin/transport-fees',
  '/admin/bus-reports',
  '/driver/dashboard',
  '/driver/student-list',
  '/driver/boarding-log'
];

uiRoutes.forEach(route => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${route}.html`));
  });
});

// Endpoint for Mobile QR Code Network URL
app.get('/api/info', (req, res) => {
  const ips = getLocalIpAddresses();
  const mainIp = ips[0];
  res.json({
    success: true,
    localIp: mainIp,
    allIps: ips,
    port: PORT,
    mobileUrl: `http://${mainIp}:${PORT}?mode=mobile`
  });
});

// SPA Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Export app and initDatabase for serverless/Firebase Cloud Functions deployment
module.exports = { app, initDatabase };

// Start server if run directly (e.g. node server.js)
if (require.main === module) {
  initDatabase()
    .then(() => {
      const localIp = getLocalIpAddress();
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`====================================================`);
        console.log(`🚀 Face Detection Attendance System running!`);
        console.log(`🌐 Local Web Server: http://localhost:${PORT}`);
        console.log(`📱 Mobile Network:   http://${localIp}:${PORT}?mode=mobile`);
        console.log(`====================================================`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}
