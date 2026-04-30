// ==================== Role & User Management ====================
let currentRole = localStorage.getItem('userRole') || 'admin';
let currentDisplayName = localStorage.getItem('displayName') || '';
let currentTechId = localStorage.getItem('technicianId') || '';

function isAdmin() { return currentRole === 'admin'; }
function isTechnician() { return currentRole === 'technician'; }

// โหลด role + ข้อมูลผู้ใช้จาก server
async function loadRole() {
  try {
    const data = await API.get('/api/auth/me');
    currentRole = data.role;
    currentDisplayName = data.displayName || '';
    currentTechId = data.technicianId || '';
    localStorage.setItem('userRole', currentRole);
    localStorage.setItem('displayName', currentDisplayName);
    localStorage.setItem('technicianId', currentTechId);
    applySidebarRole();
    return currentRole;
  } catch {
    return currentRole;
  }
}

// ซ่อน/แสดง menu ตาม role + แสดงชื่อผู้ใช้
function applySidebarRole() {
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
  document.querySelectorAll('[data-tech-hide]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // แสดงป้าย role + ชื่อ ใน sidebar
  const badge = document.getElementById('roleBadge');
  if (badge) {
    if (isAdmin()) {
      badge.textContent = 'Admin';
      badge.className = 'badge badge-success';
    } else {
      badge.textContent = currentDisplayName || 'ช่าง';
      badge.className = 'badge badge-blue';
    }
  }
}

// เช็คว่าช่างพยายามเข้าหน้า admin-only
function checkAdminPage() {
  const adminPages = ['customers', 'customer-form', 'history', 'settings', 'technicians', 'technician-form'];
  const currentPage = window.location.pathname.replace('/', '').replace('.html', '');
  if (adminPages.includes(currentPage) && isTechnician()) {
    window.location.href = '/dashboard';
    return false;
  }
  return true;
}

// ==================== API Helper ====================
const API = {
  async request(url, options = {}) {
    const defaultOptions = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };

    if (options.body instanceof FormData) {
      delete defaultOptions.headers['Content-Type'];
    }

    try {
      const res = await fetch(url, defaultOptions);

      if (res.status === 401) {
        localStorage.removeItem('userRole');
        localStorage.removeItem('displayName');
        localStorage.removeItem('technicianId');
        window.location.href = '/';
        return null;
      }

      if (res.status === 403) {
        showToast('ไม่มีสิทธิ์เข้าถึง (เฉพาะ Admin)', 'error');
        return null;
      }

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('spreadsheet') || contentType.includes('pdf')) {
        if (!res.ok) throw new Error('Export failed');
        return res;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      return data;
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      }
      throw err;
    }
  },

  get(url) { return this.request(url); },
  post(url, body) { return this.request(url, { method: 'POST', body: JSON.stringify(body) }); },
  put(url, body) { return this.request(url, { method: 'PUT', body: JSON.stringify(body) }); },
  upload(url, formData) { return this.request(url, { method: 'POST', body: formData }); },
};

// ==================== Toast Notifications ====================
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✓', error: '✕', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== Date Formatting ====================
const BE_OFFSET = 543;
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function toThaiDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + BE_OFFSET}`;
}

function toThaiDateFull(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${THAI_MONTHS_FULL[d.getMonth()]} ${d.getFullYear() + BE_OFFSET}`;
}

function daysFromNow(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

// ==================== Number Formatting ====================
function formatNumber(n) {
  if (!n && n !== 0) return '-';
  return Number(n).toLocaleString('th-TH');
}

function formatPrice(n) {
  if (!n && n !== 0) return '-';
  return Number(n).toLocaleString('th-TH') + ' บาท';
}

// ==================== Status Helpers ====================
function statusBadge(status) {
  const map = {
    active: '<span class="badge badge-success">ใช้งาน</span>',
    expired: '<span class="badge badge-warning">หมดสัญญา</span>',
    cancelled: '<span class="badge badge-gray">ยกเลิก</span>',
    pending: '<span class="badge badge-warning">รอดำเนินการ</span>',
    completed: '<span class="badge badge-success">เสร็จสิ้น</span>',
    overdue: '<span class="badge badge-danger">เกินกำหนด</span>',
  };
  return map[status] || `<span class="badge badge-gray">${status}</span>`;
}

function daysLabel(days) {
  if (days === null || days === undefined) return '';
  if (days < 0) return `<span class="badge badge-danger">เกิน ${Math.abs(days)} วัน</span>`;
  if (days === 0) return '<span class="badge badge-warning">วันนี้</span>';
  if (days <= 7) return `<span class="badge badge-blue">อีก ${days} วัน</span>`;
  return `<span class="badge badge-gray">อีก ${days} วัน</span>`;
}

// ==================== Sidebar ====================
function initSidebar() {
  const currentPage = window.location.pathname.replace('/', '').replace('.html', '') || 'dashboard';

  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    const href = a.getAttribute('href').replace('/', '').replace('.html', '');
    if (href === currentPage) {
      a.classList.add('active');
    }
  });

  // Mobile toggle
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');

  if (toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // โหลด role แล้วปรับ sidebar
  loadRole();
}

// ==================== Modal Helper ====================
function showModal(title, bodyHTML, footerHTML) {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  return modal;
}

function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
}

// ==================== Loading State ====================
function showLoading(container) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลด...</div>';
  }
}

// ==================== Export Helper ====================
async function downloadExport(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('ดาวน์โหลดสำเร็จ');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==================== Logout ====================
async function logout() {
  await API.post('/api/auth/logout');
  localStorage.removeItem('userRole');
  localStorage.removeItem('displayName');
  localStorage.removeItem('technicianId');
  window.location.href = '/';
}

// ==================== URL Params ====================
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  checkAdminPage();
});
