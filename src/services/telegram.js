const https = require('https');
const config = require('../config');

function sendMessage(text) {
  return new Promise((resolve, reject) => {
    if (!config.telegram.botToken || !config.telegram.chatId) {
      console.log('[Telegram] Not configured, skipping:', text.substring(0, 50));
      return resolve({ ok: false, reason: 'not_configured' });
    }

    const data = JSON.stringify({
      chat_id: config.telegram.chatId,
      text,
      parse_mode: 'HTML',
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${config.telegram.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ ok: false, body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ส่งข้อความแบบไม่รอผล
function sendMessageAsync(text) {
  sendMessage(text).catch(err => {
    console.error('[Telegram] Send error:', err.message);
  });
}

module.exports = { sendMessage, sendMessageAsync };
