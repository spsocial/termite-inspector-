const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./src/config');
const authMiddleware = require('./src/middleware/auth');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (ก่อน auth เพื่อให้ login page โหลดได้)
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware สำหรับ API และ HTML pages (ยกเว้น login)
app.use((req, res, next) => {
  // ให้ static files ผ่านได้
  if (req.path.match(/\.(css|js|png|jpg|svg|ico|woff2?|ttf)$/)) {
    return next();
  }
  // ให้ login page ผ่าน
  if (req.path === '/' || req.path === '/index.html' || req.path === '/api/auth/login') {
    return next();
  }
  return authMiddleware(req, res, next);
});

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/inspections', require('./src/routes/inspections'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/export', require('./src/routes/export'));
app.use('/api/history', require('./src/routes/history'));

// Telegram test endpoint
app.post('/api/telegram/test', async (req, res) => {
  try {
    const telegram = require('./src/services/telegram');
    const result = await telegram.sendMessage('🧪 ทดสอบการแจ้งเตือน - ระบบทำงานปกติ');
    res.json({ success: result.ok, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger daily summary manually
app.post('/api/telegram/daily-summary', async (req, res) => {
  try {
    const { sendDailySummary } = require('./src/services/cronJobs');
    await sendDailySummary();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HTML pages (SPA-like routing)
const pages = ['dashboard', 'customers', 'customer-form', 'inspections', 'inspection-detail', 'history', 'settings'];
pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
  app.get(`/${page}.html`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

// Start server
async function start() {
  // Initialize Google Sheets (สร้าง sheets ที่ยังไม่มี)
  try {
    if (config.google.serviceAccountEmail && config.google.privateKey) {
      const sheets = require('./src/services/googleSheets');
      await sheets.ensureSheets();
      console.log('Google Sheets connected');

      // Start cron jobs
      const { startCronJobs } = require('./src/services/cronJobs');
      startCronJobs();
    } else {
      console.log('Google Sheets not configured - running in demo mode');
    }
  } catch (err) {
    console.error('Google Sheets init error:', err.message);
    console.log('Server will start anyway - some features may not work');
  }

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Open http://localhost:${config.port}`);
  });
}

start();
