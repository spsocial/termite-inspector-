const jwt = require('jsonwebtoken');
const config = require('../config');

function authMiddleware(req, res, next) {
  // ข้ามการเช็ค auth สำหรับ login และ static files
  if (req.path === '/api/auth/login' || req.path === '/' || req.path === '/index.html') {
    return next();
  }

  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    }
    return res.redirect('/');
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    }
    return res.redirect('/');
  }
}

// Middleware สำหรับหน้าที่ admin เท่านั้น
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง (เฉพาะ Admin)' });
    }
    return res.redirect('/dashboard');
  }
  next();
}

// GET /api/auth/me - ดึงข้อมูล role ปัจจุบัน
function getMeHandler(req, res) {
  res.json({ role: req.user?.role || 'unknown' });
}

module.exports = { authMiddleware, adminOnly, getMeHandler };
