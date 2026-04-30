const { google } = require('googleapis');
const config = require('../config');

let sheetsClient = null;
let driveClient = null;

async function getAuth() {
  const auth = new google.auth.JWT(
    config.google.serviceAccountEmail,
    null,
    config.google.privateKey,
    [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ]
  );
  await auth.authorize();
  return auth;
}

async function getSheets() {
  if (!sheetsClient) {
    const auth = await getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

async function getDrive() {
  if (!driveClient) {
    const auth = await getAuth();
    driveClient = google.drive({ version: 'v3', auth });
  }
  return driveClient;
}

// อ่านข้อมูลทั้งหมดจากชีท
async function getRows(sheetName) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.spreadsheetId,
    range: `${sheetName}!A:Z`,
  });
  return res.data.values || [];
}

// เพิ่มแถวใหม่
async function appendRow(sheetName, values) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

// เพิ่มหลายแถว
async function appendRows(sheetName, rows) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

// อัพเดทแถว (rowIndex เริ่มที่ 1 = header)
async function updateRow(sheetName, rowIndex, values) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.spreadsheetId,
    range: `${sheetName}!A${rowIndex}:Z${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  });
}

// อัพเดทเฉพาะบางเซลล์
async function updateCells(sheetName, range, values) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.spreadsheetId,
    range: `${sheetName}!${range}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

// ลบแถว (ใช้ sheetId ซึ่งต้องหาจาก sheet metadata)
async function deleteRows(sheetName, rowIndices) {
  if (rowIndices.length === 0) return;
  const sheets = await getSheets();

  // หา sheetId จากชื่อ sheet
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.google.spreadsheetId,
  });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheetMeta) return;
  const sheetId = sheetMeta.properties.sheetId;

  // ลบจากล่างขึ้นบน เพื่อไม่ให้ index เลื่อน
  const sorted = [...rowIndices].sort((a, b) => b - a);
  const requests = sorted.map(rowIndex => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex - 1, // 0-based
        endIndex: rowIndex,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.google.spreadsheetId,
    requestBody: { requests },
  });
}

// หา row index จากค่าในคอลัมน์แรก (รหัส)
async function findRowIndex(sheetName, id) {
  const rows = await getRows(sheetName);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return i + 1; // +1 เพราะ Sheets เริ่มที่ 1
  }
  return -1;
}

// สร้างรหัสใหม่ (เช่น C001 → C002)
async function generateId(sheetName, prefix) {
  const rows = await getRows(sheetName);
  let maxNum = 0;
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i][0] || '';
    if (id.startsWith(prefix)) {
      const num = parseInt(id.replace(prefix, ''));
      if (num > maxNum) maxNum = num;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

// อัพโหลดไฟล์ไปยัง Google Drive
async function uploadFile(fileBuffer, fileName, mimeType) {
  const drive = await getDrive();

  if (!config.google.driveFolderId) {
    throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_DRIVE_FOLDER_ID');
  }

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [config.google.driveFolderId],
    },
    media: {
      mimeType,
      body: require('stream').Readable.from(fileBuffer),
    },
    fields: 'id, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  // ทำให้ไฟล์เป็น public
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true,
  });

  return {
    fileId: res.data.id,
    webViewLink: res.data.webViewLink,
    thumbnailLink: `https://drive.google.com/thumbnail?id=${res.data.id}&sz=w400`,
    directLink: `https://drive.google.com/uc?id=${res.data.id}`,
  };
}

// ดึง sheet metadata (เช็คว่ามีชีทตามต้องการหรือยัง)
async function ensureSheets() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: config.google.spreadsheetId,
  });

  const existingSheets = res.data.sheets.map(s => s.properties.title);
  const requiredSheets = [config.sheets.customers, config.sheets.inspections, config.sheets.auditLog, config.sheets.technicians];

  for (const sheetName of requiredSheets) {
    if (!existingSheets.includes(sheetName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.google.spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: sheetName } },
          }],
        },
      });

      // เพิ่ม header
      if (sheetName === config.sheets.customers) {
        await appendRow(sheetName, [
          'รหัสลูกค้า', 'ชื่อ', 'เบอร์โทร', 'ที่อยู่', 'ลักษณะอาคาร',
          'พื้นที่(ตร.ม.)', 'ลักษณะงาน', 'ราคา', 'วันทำสัญญา', 'วันหมดสัญญา',
          'รอบรับประกัน(ปี)', 'รอบตรวจเช็ค(เดือน)', 'สถานะ', 'หมายเหตุ',
          'created_at', 'updated_at', 'Google Maps', 'รูปบ้าน',
        ]);
      } else if (sheetName === config.sheets.inspections) {
        await appendRow(sheetName, [
          'รหัสตรวจเช็ค', 'รหัสลูกค้า', 'รอบที่', 'วันกำหนด',
          'วันตรวจจริง', 'สถานะ', 'ผลการตรวจ', 'ช่างผู้ตรวจ',
          'ลิงก์รูปถ่าย', 'created_at', 'updated_at',
          'รับงานโดย(ID)', 'รับงานโดย(ชื่อ)',
        ]);
      } else if (sheetName === config.sheets.auditLog) {
        await appendRow(sheetName, [
          'timestamp', 'action', 'entity', 'entity_id',
          'changes', 'user',
        ]);
      } else if (sheetName === config.sheets.technicians) {
        await appendRow(sheetName, [
          'รหัสช่าง', 'ชื่อ', 'PIN', 'เบอร์โทร',
          'สถานะ', 'created_at', 'updated_at',
        ]);
      }
    }
  }
}

module.exports = {
  getRows,
  appendRow,
  appendRows,
  updateRow,
  updateCells,
  findRowIndex,
  generateId,
  uploadFile,
  deleteRows,
  ensureSheets,
  getSheets,
  getDrive,
};
