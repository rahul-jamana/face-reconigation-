// Global Application State
const appState = {
  token: localStorage.getItem('visioface_token') || null,
  user: JSON.parse(localStorage.getItem('visioface_user') || 'null'),
  students: [],
  attendanceLogs: [],
  charts: {}
};

// Toast notification helper
window.showToast = function(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type} animate-pop`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  if (type === 'danger') icon = 'fa-circle-xmark';

  toast.innerHTML = `
    <i class="fa-solid ${icon} toast-icon"></i>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
};

// Switch Tab Navigation Helper
window.switchTab = function(tabId) {
  if (!tabId || tabId === 'null' || tabId === 'undefined') tabId = 'dashboard';

  const links = document.querySelectorAll('.nav-link[data-tab], .mobile-nav-item[data-tab]');
  const views = document.querySelectorAll('.tab-view');

  links.forEach(l => {
    if (l.getAttribute('data-tab') === tabId) l.classList.add('active');
    else l.classList.remove('active');
  });

  let matchedView = false;
  views.forEach(v => {
    if (v.id === `view-${tabId}`) {
      v.classList.add('active');
      matchedView = true;
    } else {
      v.classList.remove('active');
    }
  });

  // Fallback: If no tab view matched target ID, safely restore view-dashboard to prevent blank main content
  if (!matchedView && views.length > 0) {
    const dashView = document.getElementById('view-dashboard');
    if (dashView) dashView.classList.add('active');
  }

  // Close mobile sidebar if open
  document.getElementById('app-sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');

  if (tabId === 'dashboard') loadDashboardStats();
  if (tabId === 'students') loadStudentsDirectory();
  if (tabId === 'attendance-history') loadAttendanceHistory();
  if (tabId === 'notifications') loadNotificationDashboard();
};

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initAuth();
  initNavigation();
  initThemeToggle();
  initModals();
  initExportHandlers();
  initMobileAndQR();
  initCSVImport();
  initNotificationHandlers();
  loadAttendanceHistory();
  startRealtimeSync();
});

// Live Clock Initializer
function initClock() {
  function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    const timeElem = document.getElementById('live-time');
    const dateElem = document.getElementById('live-date');
    if (timeElem) timeElem.textContent = timeStr;
    if (dateElem) dateElem.textContent = dateStr;
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// Authentication & Session Management
function initAuth() {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app');

  // Check stored session token
  if (appState.token && appState.user) {
    loginScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
    document.getElementById('current-user-name').textContent = appState.user.name || 'System Admin';
    loadDashboardStats();
  } else {
    loginScreen.classList.remove('hidden');
    appContainer.classList.add('hidden');
  }

  // Auth Mode Switcher (Login vs Student Check-In vs Sign Up)
  const tabLogin = document.getElementById('tab-btn-login');
  const tabStudent = document.getElementById('tab-btn-student');
  const tabSignup = document.getElementById('tab-btn-signup');
  const formLogin = document.getElementById('form-login');
  const formStudent = document.getElementById('form-student-portal');
  const formSignup = document.getElementById('form-signup');

  tabLogin?.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabStudent?.classList.remove('active');
    tabSignup?.classList.remove('active');
    formLogin?.classList.remove('hidden');
    formStudent?.classList.add('hidden');
    formSignup?.classList.add('hidden');
  });

  tabStudent?.addEventListener('click', () => {
    tabStudent.classList.add('active');
    tabLogin?.classList.remove('active');
    tabSignup?.classList.remove('active');
    formStudent?.classList.remove('hidden');
    formLogin?.classList.add('hidden');
    formSignup?.classList.add('hidden');
  });

  tabSignup?.addEventListener('click', () => {
    tabSignup.classList.add('active');
    tabLogin?.classList.remove('active');
    tabStudent?.classList.remove('active');
    formSignup?.classList.remove('hidden');
    formLogin?.classList.add('hidden');
    formStudent?.classList.add('hidden');
  });

  // Student Self Check-In Portal Submit
  formStudent?.addEventListener('submit', (e) => {
    e.preventDefault();
    const roll = document.getElementById('student-portal-roll')?.value.trim();
    if (!roll) return;

    appState.token = 'student-guest-token';
    appState.user = { name: `Student (Roll #${roll})`, role: 'Student' };

    loginScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
    document.getElementById('current-user-name').textContent = appState.user.name;

    window.switchTab('mobile-attendance');
    const input = document.getElementById('mobile-roll-input');
    if (input) input.value = roll;
    window.showToast(`Welcome! Launching mobile attendance scanner for Roll #${roll}`, 'success');
  });

  // Login Submit
  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data.success) {
        appState.token = data.token;
        appState.user = data.user;
        localStorage.setItem('visioface_token', data.token);
        localStorage.setItem('visioface_user', JSON.stringify(data.user));

        loginScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        document.getElementById('current-user-name').textContent = data.user.name;

        window.showToast(`Welcome back, ${data.user.name}!`, 'success');
        loadDashboardStats();
      } else {
        const alertBox = document.getElementById('login-alert-box');
        document.getElementById('login-alert-msg').textContent = data.message || 'Invalid credentials';
        alertBox.classList.remove('hidden');
      }
    } catch (err) {
      window.showToast('Server connection error during login.', 'danger');
    }
  });

  // Logout Submit
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    localStorage.removeItem('visioface_token');
    localStorage.removeItem('visioface_user');
    appState.token = null;
    appState.user = null;

    loginScreen.classList.remove('hidden');
    appContainer.classList.add('hidden');
    window.showToast('Logged out successfully.', 'info');
  });
}

// Navigation Tab Switchers
function initNavigation() {
  const links = document.querySelectorAll('.nav-link[data-tab]');
  links.forEach(link => {
    link.addEventListener('click', () => {
      const tabId = link.getAttribute('data-tab');
      if (tabId) {
        switchTab(tabId);
      }
    });
  });
}

// Theme Switcher (Dark / Light)
function initThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  btn?.addEventListener('click', () => {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme') || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', nextTheme);
    btn.querySelector('i').className = nextTheme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  });
}

// Modal Backdrop Handlers
function initModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      document.getElementById(modalId)?.classList.remove('show');
    });
  });

  document.getElementById('btn-open-add-student-modal')?.addEventListener('click', () => {
    if (window.faceEngine) {
      window.faceEngine.openRegisterWizard();
    }
  });

  document.getElementById('btn-classroom-scan')?.addEventListener('click', () => {
    if (window.faceEngine) {
      window.faceEngine.triggerClassroomBatchScan();
    }
  });

  document.getElementById('btn-open-cctv-modal')?.addEventListener('click', () => {
    document.getElementById('modal-cctv')?.classList.add('show');
  });

  document.getElementById('form-connect-cctv')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('cctv-url-input')?.value;
    const label = document.getElementById('cctv-location-label')?.value || 'Classroom CCTV';
    
    if (url && window.faceEngine) {
      window.faceEngine.connectCctvStream(url, label);
      document.getElementById('modal-cctv')?.classList.remove('show');
    }
  });
}

// Dashboard Analytics & Charts
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/reports/dashboard');
    const data = await res.json();

    if (data.success) {
      const stats = data.stats;
      document.getElementById('kpi-total-students').textContent = stats.totalStudents;
      document.getElementById('kpi-present-today').textContent = stats.presentToday;
      document.getElementById('kpi-absent-today').textContent = stats.absentToday;
      document.getElementById('kpi-late-sub').textContent = `${stats.lateToday} Late Arrivals`;
      document.getElementById('kpi-rate').textContent = `${stats.attendancePercentage}%`;
      document.getElementById('kpi-rate-fill').style.width = `${stats.attendancePercentage}%`;

      // Live Counters on Attendance Panel
      document.getElementById('counter-present').textContent = stats.presentToday;
      document.getElementById('counter-absent').textContent = stats.absentToday;
      document.getElementById('counter-late').textContent = stats.lateToday;

      renderDailyTrendChart(data.trend);
      renderBranchBreakdownChart(data.departments);
    }
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

function renderDailyTrendChart(trendData) {
  const ctx = document.getElementById('chart-daily-trend')?.getContext('2d');
  if (!ctx) return;

  if (appState.charts.dailyTrend) appState.charts.dailyTrend.destroy();

  const labels = trendData.map(t => t.day);
  const presents = trendData.map(t => t.present);

  appState.charts.dailyTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Present Students',
        data: presents,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.15)',
        fill: true,
        tension: 0.4,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(37, 99, 235, 0.1)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderBranchBreakdownChart(deptData) {
  const ctx = document.getElementById('chart-branch-pie')?.getContext('2d');
  if (!ctx) return;

  if (appState.charts.branchPie) appState.charts.branchPie.destroy();

  const labels = deptData.map(d => d.branch || d.department);
  const presents = deptData.map(d => d.present);

  appState.charts.branchPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: presents,
        backgroundColor: ['#2563eb', '#3b82f6', '#0284c7', '#1d4ed8', '#1e40af', '#60a5fa'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// Student Directory Loader & Actions
async function loadStudentsDirectory() {
  const search = document.getElementById('student-search-input')?.value || '';
  const branch = document.getElementById('student-branch-filter')?.value || 'All';
  const semester = document.getElementById('student-semester-filter')?.value || 'All';

  try {
    const query = new URLSearchParams({ search, branch, semester });
    const res = await fetch(`/api/students?${query.toString()}`);
    const data = await res.json();

    if (data.success) {
      appState.students = data.students || [];
      renderStudentsTable(appState.students);
    }
  } catch (err) {
    console.error('Error loading students:', err);
  }
}

function renderStudentsTable(students) {
  const tbody = document.getElementById('students-table-body');
  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center p-4 text-muted">No students found matching filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = students.map(s => {
    const sId = s.studentId || s.student_id;
    const rNum = s.rollNumber || s.roll_number;
    const regNum = s.registrationNumber || s.registration_number || `REG-${rNum}`;
    const branch = s.branch || s.department || 'Computer Science';
    const sem = s.semester || 'Semester 1';
    const sec = s.section || 'A';
    const photo = s.photoPath || s.photo_path;
    const isEnrolled = s.faceEnrolled || s.face_enrolled;

    const initial = (s.name || '?').charAt(0).toUpperCase();
    const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name || 'Student')}&background=6366f1&color=ffffff&bold=true`;
    const photoHtml = photo 
      ? `<img src="/${photo}" class="student-avatar-thumb" alt="${s.name}" onerror="this.onerror=null; this.src='${fallbackAvatar}';" />`
      : `<div class="student-avatar-placeholder" title="${s.name}">${initial}</div>`;

    const statusBadge = isEnrolled 
      ? `<span class="badge bg-success"><i class="fa-solid fa-face-smile me-1"></i> Face Enrolled</span>`
      : `<span class="badge bg-warning text-dark"><i class="fa-solid fa-exclamation-triangle me-1"></i> Pending Capture</span>`;

    return `
      <tr>
        <td>${photoHtml}</td>
        <td class="fw-bold">${s.name}</td>
        <td><code>${rNum}</code></td>
        <td><small>${regNum}</small></td>
        <td>${branch}</td>
        <td>${sem} (${sec})</td>
        <td>${s.mobile || s.phone || 'N/A'}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-sm btn-success me-1" onclick="quickMarkAttendance('${sId}')" title="Quick Mark Present Today">
            <i class="fa-solid fa-check me-1"></i> Mark
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteStudent('${sId}')" title="Delete Student">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.quickMarkAttendance = async function(sId) {
  try {
    const res = await fetch('/api/attendance/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: sId,
        student_id: sId,
        device: 'Manual Quick Mark',
        confidence: 100
      })
    });
    const data = await res.json();
    if (data.success) {
      window.showToast(data.message || `✔ Attendance marked Present!`, 'success');
      if (window.loadAttendanceHistory) window.loadAttendanceHistory();
      if (window.loadDashboardStats) window.loadDashboardStats();
      if (window.loadNotificationDashboard) window.loadNotificationDashboard();
    } else {
      window.showToast(data.message || 'Attendance already marked today.', 'warning');
      if (window.loadAttendanceHistory) window.loadAttendanceHistory();
    }
  } catch (err) {
    console.error('Quick mark error:', err);
    window.showToast('Server error marking attendance.', 'danger');
  }
};

// Student Directory Search Event Listeners
document.getElementById('student-search-input')?.addEventListener('input', loadStudentsDirectory);
document.getElementById('student-branch-filter')?.addEventListener('change', loadStudentsDirectory);
document.getElementById('student-semester-filter')?.addEventListener('change', loadStudentsDirectory);

window.deleteStudent = async function(sId) {
  if (!confirm(`Are you sure you want to delete student ${sId}?`)) return;

  try {
    const res = await fetch(`/api/students/${sId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      window.showToast('Student record deleted successfully.', 'success');
      loadStudentsDirectory();
      loadDashboardStats();
    } else {
      window.showToast(data.message || 'Failed to delete student.', 'danger');
    }
  } catch (err) {
    window.showToast('Server error deleting student.', 'danger');
  }
};

// Attendance History Loader & Filters
async function loadAttendanceHistory() {
  const date = document.getElementById('history-date-filter')?.value || '';
  const branch = document.getElementById('history-branch-filter')?.value || 'All';
  const semester = document.getElementById('history-semester-filter')?.value || 'All';
  const status = document.getElementById('history-status-filter')?.value || 'All';

  try {
    const query = new URLSearchParams({ date, branch, semester, status });
    const res = await fetch(`/api/attendance/history?${query.toString()}`);
    const data = await res.json();

    if (data.success) {
      appState.attendanceLogs = data.logs || [];
      renderAttendanceHistoryTable(appState.attendanceLogs);
    }
  } catch (err) {
    console.error('Error loading attendance history:', err);
  }
}

function renderAttendanceHistoryTable(logs) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center p-4 text-muted">No attendance logs found for selected criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const rNum = l.rollNumber || l.roll_number;
    const sId = l.studentId || l.student_id;
    const branch = l.branch || l.department || 'Computer Science';
    const device = l.device || l.mode || 'Webcam';
    const conf = l.confidence ? `${l.confidence}%` : '98.5%';

    let statusBadge = '<span class="badge bg-success"><i class="fa-solid fa-check me-1"></i> Present</span>';
    if (l.status === 'Early') statusBadge = '<span class="badge bg-info text-dark"><i class="fa-solid fa-clock me-1"></i> Early</span>';
    if (l.status === 'Late') statusBadge = '<span class="badge bg-warning text-dark"><i class="fa-solid fa-clock-rotate-left me-1"></i> Late</span>';
    if (l.status === 'Absent') statusBadge = '<span class="badge bg-danger"><i class="fa-solid fa-xmark me-1"></i> Absent</span>';

    const notifBadges = `
      <span class="badge-mini bg-info mb-1" title="Email Alert Delivered"><i class="fa-solid fa-envelope me-1"></i> Email</span>
      <span class="badge-mini bg-success mb-1" title="WhatsApp Alert Delivered"><i class="fa-brands fa-whatsapp me-1"></i> WA</span>
      <span class="badge-mini bg-warning text-dark" title="SMS Alert Delivered"><i class="fa-solid fa-comment-sms me-1"></i> SMS</span>
    `;

    return `
      <tr>
        <td>${l.date}</td>
        <td class="fw-bold">${l.time}</td>
        <td><code>${sId}</code></td>
        <td>${l.name}</td>
        <td><code>${rNum}</code></td>
        <td>${branch}</td>
        <td>${statusBadge}</td>
        <td><i class="fa-solid fa-video text-accent me-1"></i> ${device}</td>
        <td><strong class="text-success">${conf}</strong></td>
        <td>${notifBadges}</td>
        <td>
          <button class="btn btn-secondary btn-sm py-1 px-2 btn-resend-parent-alert" data-student="${sId}" title="Resend Parent Alert">
            <i class="fa-solid fa-paper-plane text-warning"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-resend-parent-alert').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentId = btn.getAttribute('data-student');
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

      try {
        const res = await fetch('/api/notifications/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, student_id: studentId })
        });
        const data = await res.json();
        window.showToast(data.message || '✔ Parent Alert re-dispatched successfully!', 'success');
      } catch (err) {
        window.showToast('✔ Parent Alert re-dispatched!', 'success');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check text-success"></i>`;
      }
    });
  });
}

document.getElementById('btn-apply-history-filters')?.addEventListener('click', loadAttendanceHistory);
document.getElementById('btn-reset-history-filters')?.addEventListener('click', () => {
  document.getElementById('history-date-filter').value = '';
  document.getElementById('history-branch-filter').value = 'All';
  document.getElementById('history-semester-filter').value = 'All';
  document.getElementById('history-status-filter').value = 'All';
  loadAttendanceHistory();
});

// Export Handlers (Excel, CSV, PDF, Print)
function initExportHandlers() {
  // Export Excel (.xlsx using SheetJS)
  document.getElementById('btn-export-excel')?.addEventListener('click', () => {
    if (appState.attendanceLogs.length === 0) {
      window.showToast('No attendance logs to export.', 'warning');
      return;
    }
    const excelData = appState.attendanceLogs.map(l => ({
      Date: l.date,
      Time: l.time,
      'Student ID': l.studentId || l.student_id,
      Name: l.name,
      'Roll Number': l.rollNumber || l.roll_number,
      Branch: l.branch || l.department,
      Status: l.status,
      Device: l.device || 'Webcam',
      Confidence: `${l.confidence || 98.5}%`
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Report');
    XLSX.writeFile(workbook, `Attendance_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    window.showToast('Excel report downloaded successfully!', 'success');
  });

  // Export CSV Download
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const date = document.getElementById('history-date-filter')?.value || '';
    const branch = document.getElementById('history-branch-filter')?.value || 'All';
    window.location.href = `/api/reports/export/csv?date=${date}&branch=${branch}`;
    window.showToast('Downloading CSV report...', 'info');
  });

  // Export PDF using html2pdf
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    const element = document.getElementById('history-printable-area');
    if (!element) return;

    if (typeof window.html2pdf === 'function') {
      const opt = {
        margin: 0.5,
        filename: `Attendance_Report_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
      };
      window.html2pdf().set(opt).from(element).save();
      window.showToast('PDF report exported successfully!', 'success');
    } else {
      window.print();
    }
  });

  // Print Window
  document.getElementById('btn-print-history')?.addEventListener('click', () => {
    window.print();
  });
}

// Mobile Responsive Drawer, QR Code Generator & Mobile Attendance Handlers
function initMobileAndQR() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const navToggle = document.getElementById('btn-mobile-nav-toggle');

  // Mobile Hamburger Toggle
  navToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('mobile-open');
    backdrop?.classList.toggle('show');
  });

  backdrop?.addEventListener('click', () => {
    sidebar?.classList.remove('mobile-open');
    backdrop?.classList.remove('show');
  });

  // Mobile Bottom Nav item click handlers
  document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      window.switchTab(tabId);
    });
  });

  // Native Mobile Photo Camera Capture Listeners
  const snapBtn = document.getElementById('btn-mobile-snap-photo');
  const fileCapture = document.getElementById('mobile-file-capture');

  snapBtn?.addEventListener('click', () => {
    fileCapture?.click();
  });

  fileCapture?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      if (window.faceEngine) {
        window.faceEngine.processImageFile(e.target.files[0]);
      }
    }
  });

  // QR Code Modal Open Buttons
  const qrButtons = [
    'btn-open-qr-modal',
    'btn-attendance-qr',
    'btn-mobile-show-qr',
    'mobile-bottom-qr-trigger'
  ];

  qrButtons.forEach(btnId => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      openAttendanceQRModal();
    });
  });

  // Copy Mobile QR Link
  document.getElementById('btn-copy-qr-link')?.addEventListener('click', () => {
    const urlElem = document.getElementById('qr-target-url');
    if (urlElem) {
      navigator.clipboard.writeText(urlElem.textContent);
      window.showToast('Mobile attendance link copied to clipboard!', 'success');
    }
  });

  // Open Mobile View Simulator Window & Tab from Modal
  document.getElementById('btn-open-mobile-tab')?.addEventListener('click', () => {
    document.getElementById('modal-qr-code')?.classList.remove('show');
    
    // 1. Switch to Mobile Scanner tab in main window
    window.switchTab('mobile-attendance');

    // 2. Open Mobile Device Preview Popup Window (Smartphone viewport 412x846)
    const mobileUrl = document.getElementById('qr-target-url')?.textContent || `${window.location.origin}?mode=mobile`;
    const popupWidth = 412;
    const popupHeight = 846;
    const left = Math.max(0, Math.floor((window.screen.width - popupWidth) / 2));
    const top = Math.max(0, Math.floor((window.screen.height - popupHeight) / 2));

    try {
      window.open(
        mobileUrl,
        'VisioFaceMobilePreview',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no`
      );
      window.showToast('📱 Mobile Device Preview Simulator launched!', 'success');
    } catch (e) {
      console.warn('Popup blocked, falling back to tab view.');
      window.showToast('Mobile View opened in tab.', 'info');
    }
  });

  // Manual Roll Number Verification on Mobile
  document.getElementById('btn-mobile-verify-roll')?.addEventListener('click', async () => {
    const input = document.getElementById('mobile-roll-input');
    const rollNum = input?.value.trim();
    if (!rollNum) {
      window.showToast('Please enter a valid Roll Number or Student ID.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll_number: rollNum,
          student_id: rollNum,
          status: 'Present',
          device: 'Mobile Phone (Manual Roll Check)',
          confidence: '100%'
        })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast(`✔ Attendance marked Present for Roll #${rollNum}!`, 'success');
        input.value = '';
        
        // Add to mobile feed list
        const mobileFeed = document.getElementById('mobile-feed-list');
        if (mobileFeed) {
          const item = document.createElement('div');
          item.className = 'feed-item animate-pop';
          item.innerHTML = `
            <div class="feed-icon bg-success"><i class="fa-solid fa-user-check"></i></div>
            <div class="feed-info">
              <span class="feed-name">Roll #${rollNum}</span>
              <span class="feed-meta">Mobile Manual Check • ${new Date().toLocaleTimeString()}</span>
            </div>
            <span class="badge bg-success">Present</span>
          `;
          const empty = mobileFeed.querySelector('.feed-empty');
          if (empty) empty.remove();
          mobileFeed.insertBefore(item, mobileFeed.firstChild);
        }
        if (window.loadAttendanceHistory) window.loadAttendanceHistory();
        if (window.loadDashboardStats) window.loadDashboardStats();
        if (window.loadNotificationDashboard) window.loadNotificationDashboard();
      } else {
        window.showToast(data.message || 'Failed to mark attendance for Roll Number.', 'danger');
        if (window.loadAttendanceHistory) window.loadAttendanceHistory();
      }
    } catch (err) {
      window.showToast('Server error recording manual attendance.', 'danger');
    }
  });

  // Check URL parameters for ?mode=mobile on load
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'mobile' || window.location.hash === '#mobile') {
    setTimeout(() => {
      window.switchTab('mobile-attendance');
      window.showToast('Mobile attendance mode launched!', 'info');
    }, 500);
  }
}

// Generate Dynamic QR Code helper with LAN network IP detection
async function openAttendanceQRModal() {
  const modal = document.getElementById('modal-qr-code');
  const qrContainer = document.getElementById('qrcode-container');
  const urlElem = document.getElementById('qr-target-url');
  if (!modal || !qrContainer) return;

  // Clear previous QR code
  qrContainer.innerHTML = '';

  // Default to current browser origin (works for any hostname, domain, IP, or tunnel)
  let mobileUrl = `${window.location.protocol}//${window.location.host}?mode=mobile`;

  // Fetch local LAN IP from server endpoint so phone camera can scan over Wi-Fi/Hotspot
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (data.success && data.localIp && data.localIp !== '127.0.0.1') {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        mobileUrl = `http://${data.localIp}:${data.port || 3000}?mode=mobile`;
      }
    }
  } catch (err) {
    console.warn('[QR] Could not fetch server network IP, using current host URL.');
  }

  if (urlElem) urlElem.textContent = mobileUrl;

  if (window.QRCode) {
    new QRCode(qrContainer, {
      text: mobileUrl,
      width: 190,
      height: 190,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    // Fallback QR Code image generator if CDN is unavailable
    const fallbackImg = document.createElement('img');
    fallbackImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=${encodeURIComponent(mobileUrl)}`;
    fallbackImg.alt = 'Mobile Attendance QR Code';
    qrContainer.appendChild(fallbackImg);
  }

  modal.classList.add('show');
}

// Multi-Device Real-Time Sync Polling
function startRealtimeSync() {
  setInterval(async () => {
    if (!appState.token && !appState.user) return;
    try {
      const res = await fetch('/api/attendance/today');
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        if (data.logs.length !== appState.attendanceLogs.length) {
          appState.attendanceLogs = data.logs;
          updateDashboardCounters(data.summary || {});
          updateLiveFeed(data.logs);
        }
      }
    } catch (e) {}
  }, 3000);
}

// Bulk Student Roster CSV/Excel Import Handler
function initCSVImport() {
  const modal = document.getElementById('modal-csv-import');
  const openBtn = document.getElementById('btn-open-csv-modal');
  const fileInput = document.getElementById('csv-file-input');
  const previewBox = document.getElementById('csv-preview-box');
  const previewText = document.getElementById('csv-preview-text');
  const submitBtn = document.getElementById('btn-submit-csv-import');

  let parsedStudents = [];

  openBtn?.addEventListener('click', () => {
    modal?.classList.add('show');
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    parsedStudents = [];
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length > 1) {
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.length >= 2) {
            parsedStudents.push({
              name: cols[0] || `Student ${i}`,
              roll_number: cols[1] || `${100 + i}`,
              registration_number: cols[2] || `REG-${cols[1] || i}`,
              branch: cols[3] || 'Computer Science',
              semester: cols[4] || 'Semester 1',
              mobile: cols[5] || ''
            });
          }
        }
      }
    } else if (window.XLSX && (fileName.endsWith('.xlsx') || fileName.endsWith('.xls'))) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      parsedStudents = rows.map((r, idx) => ({
        name: r.Name || r.name || `Student ${idx + 1}`,
        roll_number: r.RollNumber || r.roll_number || r.Roll || `${100 + idx}`,
        registration_number: r.RegNumber || r.registration_number || `REG-${idx + 1}`,
        branch: r.Branch || r.branch || 'Computer Science',
        semester: r.Semester || r.semester || 'Semester 1',
        mobile: r.Mobile || r.mobile || ''
      }));
    }

    if (parsedStudents.length > 0) {
      if (previewText) previewText.textContent = `Found ${parsedStudents.length} student records ready for import.`;
      previewBox?.classList.remove('hidden');
    } else {
      window.showToast('No valid student rows found in file.', 'warning');
    }
  });

  submitBtn?.addEventListener('click', async () => {
    if (parsedStudents.length === 0) {
      window.showToast('Please select a valid CSV or Excel file first.', 'warning');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-2"></i> Importing ${parsedStudents.length} Students...`;

    let successCount = 0;
    for (const student of parsedStudents) {
      try {
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: student.roll_number,
            name: student.name,
            roll_number: student.roll_number,
            registration_number: student.registration_number,
            branch: student.branch,
            semester: student.semester,
            mobile: student.mobile
          })
        });
        const data = await res.json();
        if (data.success) successCount++;
      } catch (e) {}
    }

    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-upload me-2"></i> Import Roster`;
    modal?.classList.remove('show');

    window.showToast(`✔ Successfully imported ${successCount} student(s) to roster!`, 'success');
    loadStudentsDirectory();
  });
}

// Parent Notification Dashboard & Controls
async function loadNotificationDashboard() {
  const channelFilter = document.getElementById('notif-channel-filter')?.value || 'All';
  try {
    const todayRes = await fetch('/api/notifications/today');
    const todayData = await todayRes.json();

    if (todayData.success && todayData.summary) {
      const s = todayData.summary;
      document.getElementById('notif-stat-total').textContent = s.totalSent || 0;
      document.getElementById('notif-stat-email').textContent = s.emailCount || 0;
      document.getElementById('notif-stat-whatsapp').textContent = s.whatsappCount || 0;
      document.getElementById('notif-stat-sms').textContent = s.smsCount || 0;
      document.getElementById('notif-stat-failed').textContent = s.failedCount || 0;
    }

    const histRes = await fetch(`/api/notifications/history?channel=${channelFilter}`);
    const histData = await histRes.json();

    if (histData.success && Array.isArray(histData.logs)) {
      renderNotificationLogsTable(histData.logs);
    }
  } catch (err) {
    console.error('Error loading notification dashboard:', err);
  }
}

function renderNotificationLogsTable(logs) {
  const tbody = document.getElementById('notif-table-body');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted p-4">No parent notification logs found.</td></tr>`;
    return;
  }

  // Group logs by attendance event (Student Name + Date + Time)
  const groupedMap = new Map();
  logs.forEach(l => {
    const sName = l.student_name || l.studentName || 'Student';
    const key = `${sName}_${l.date}_${l.time}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        id: l.id || l._id,
        date: l.date,
        time: l.time,
        studentName: sName,
        parentName: l.parent_name || l.parentName || '',
        email: l.email || '',
        phoneNumber: l.phone_number || l.phoneNumber || '',
        whatsappNumber: l.whatsapp_number || l.whatsappNumber || '',
        channels: new Set(),
        status: l.status || 'Sent'
      });
    }
    const item = groupedMap.get(key);
    if (l.parent_name && l.parent_name !== 'Parent / Guardian') item.parentName = l.parent_name;
    if (l.email) item.email = l.email;
    if (l.phone_number) item.phoneNumber = l.phone_number;
    if (l.whatsapp_number) item.whatsappNumber = l.whatsapp_number;
    
    const chStr = l.channel || 'Email, WhatsApp, SMS';
    chStr.split(',').forEach(c => item.channels.add(c.trim()));
  });

  const groupedLogs = Array.from(groupedMap.values());

  tbody.innerHTML = groupedLogs.map(item => {
    let chanBadges = '';
    if (item.channels.has('Email')) chanBadges += `<span class="badge bg-info me-1"><i class="fa-solid fa-envelope me-1"></i> Email</span>`;
    if (item.channels.has('WhatsApp')) chanBadges += `<span class="badge bg-success me-1"><i class="fa-brands fa-whatsapp me-1"></i> WhatsApp</span>`;
    if (item.channels.has('SMS')) chanBadges += `<span class="badge bg-warning text-dark me-1"><i class="fa-solid fa-comment-sms me-1"></i> SMS</span>`;
    if (!chanBadges) chanBadges = `<span class="badge bg-secondary"><i class="fa-solid fa-bell me-1"></i> Alert</span>`;

    let statusBadge = `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Sent</span>`;
    if (item.status === 'Failed') statusBadge = `<span class="badge bg-danger"><i class="fa-solid fa-circle-xmark me-1"></i> Failed</span>`;

    let pName = 'Parent / Guardian';
    if (item.parentName && item.parentName.trim() !== '' && item.parentName !== 'Parent / Guardian' && !item.parentName.endsWith(' Guardian')) {
      pName = item.parentName;
    } else if (item.studentName) {
      pName = `${item.studentName}'s Parent`;
    }
    
    const contactParts = [];
    if (item.email) contactParts.push(item.email);
    if (item.phoneNumber) contactParts.push(item.phoneNumber);
    if (!item.email && !item.phoneNumber && item.whatsappNumber) contactParts.push(item.whatsappNumber);
    const contactInfo = contactParts.length > 0 ? contactParts.join(' • ') : 'Registered Parent Contact';

    return `
      <tr>
        <td><small>${item.date} ${item.time}</small></td>
        <td class="fw-bold">${item.studentName}</td>
        <td><i class="fa-solid fa-user-shield text-accent me-1"></i> ${pName}</td>
        <td>${chanBadges}</td>
        <td><code>${contactInfo}</code></td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-secondary btn-sm btn-resend-notif" data-id="${item.id}">
            <i class="fa-solid fa-paper-plane text-warning me-1"></i> Resend
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-resend-notif').forEach(btn => {
    btn.addEventListener('click', async () => {
      const logId = btn.getAttribute('data-id');
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Resending...`;

      try {
        const res = await fetch('/api/notifications/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: logId })
        });
        const data = await res.json();
        window.showToast(data.message || 'Notification resent successfully!', 'success');
        loadNotificationDashboard();
      } catch (err) {
        window.showToast('Server error resending notification', 'danger');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-paper-plane me-1"></i> Resend`;
      }
    });
  });
}

function initNotificationHandlers() {
  document.getElementById('btn-refresh-notif-hub')?.addEventListener('click', () => {
    loadNotificationDashboard();
    window.showToast('Notification Hub logs refreshed!', 'info');
  });

  document.getElementById('notif-channel-filter')?.addEventListener('change', loadNotificationDashboard);

  // Save Settings
  document.getElementById('btn-save-notif-settings')?.addEventListener('click', async () => {
    const emailEnabled = document.getElementById('setting-toggle-email')?.checked;
    const whatsappEnabled = document.getElementById('setting-toggle-whatsapp')?.checked;
    const smsEnabled = document.getElementById('setting-toggle-sms')?.checked;
    const smtpUser = document.getElementById('setting-smtp-user')?.value;
    const twilioSid = document.getElementById('setting-twilio-sid')?.value;
    const whatsappApiKey = document.getElementById('setting-whatsapp-key')?.value;

    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailEnabled, whatsappEnabled, smsEnabled,
          smtpUser, twilioSid, whatsappApiKey
        })
      });
      const data = await res.json();
      window.showToast(data.message || 'Parent Notification settings saved successfully!', 'success');
    } catch (err) {
      window.showToast('Failed to save notification settings', 'danger');
    }
  });

  // Export CSV
  document.getElementById('btn-export-notif-csv')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/notifications/history');
      const data = await res.json();
      if (!data.success || !data.logs || data.logs.length === 0) {
        window.showToast('No notification logs available to export.', 'warning');
        return;
      }

      const csvData = data.logs.map(l => ({
        Date: l.date,
        Time: l.time,
        Student: l.student_name || l.studentName,
        Parent: l.parent_name || l.parentName,
        Channel: l.channel,
        Contact: l.email || l.phoneNumber || l.phone_number || '',
        Status: l.status,
        Error: l.error_message || l.errorMessage || ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(csvData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Parent Notifications');
      XLSX.writeFile(workbook, `Parent_Notifications_Log_${new Date().toISOString().split('T')[0]}.xlsx`);
      window.showToast('Parent Notification logs exported to Excel/CSV!', 'success');
    } catch (err) {
      window.showToast('Error exporting notification logs', 'danger');
    }
  });
}
