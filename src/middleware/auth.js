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

module.exports = authMiddleware;
