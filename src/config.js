require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  appPin: process.env.APP_PIN || '1234',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',

  google: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\\\n/g, '\n').replace(/\\n/g, '\n'),
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  sheets: {
    customers: 'ลูกค้า',
    inspections: 'ตรวจเช็ค',
    auditLog: 'ประวัติแก้ไข',
    technicians: 'ช่าง',
  },
};
