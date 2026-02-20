// แปลงวันที่ระหว่าง พ.ศ. กับ ค.ศ.
const BE_OFFSET = 543;

// แปลงจากสตริง พ.ศ. (เช่น "2-ม.ค.-63" หรือ "2/1/2563") เป็น Date object (ค.ศ.)
function parseThaiDate(str) {
  if (!str) return null;
  str = String(str).trim();

  // ISO format: 2024-01-15
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return new Date(str);
  }

  // Thai short format: "2-ม.ค.-63" or "6-ม.ค.-63"
  const thaiMonths = {
    'ม.ค.': 0, 'ก.พ.': 1, 'มี.ค.': 2, 'เม.ย.': 3,
    'พ.ค.': 4, 'มิ.ย.': 5, 'ก.ค.': 6, 'ส.ค.': 7,
    'ก.ย.': 8, 'ต.ค.': 9, 'พ.ย.': 10, 'ธ.ค.': 11,
  };

  const match = str.match(/^(\d{1,2})-(.+?)-(\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1]);
    const monthStr = match[2];
    const yearRaw = parseInt(match[3]);

    const month = thaiMonths[monthStr];
    if (month === undefined) return null;

    // ถ้าปีเป็น 2 หลัก สมมติว่าเป็น พ.ศ. (63 → 2563 → 2020 ค.ศ.)
    let yearBE = yearRaw;
    if (yearRaw < 100) {
      yearBE = yearRaw + 2500;
    }
    const yearCE = yearBE - BE_OFFSET;

    return new Date(yearCE, month, day);
  }

  // Try native parse as fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// แปลง Date → ISO string (ค.ศ.)
function toISO(date) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  return date.toISOString().split('T')[0];
}

// แปลง Date → Thai format สำหรับแสดง (เช่น "15 ม.ค. 2567")
function toThaiDisplay(date) {
  if (!date) return '-';
  if (typeof date === 'string') date = new Date(date);
  if (isNaN(date.getTime())) return '-';

  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];

  const day = date.getDate();
  const month = thaiMonths[date.getMonth()];
  const yearBE = date.getFullYear() + BE_OFFSET;

  return `${day} ${month} ${yearBE}`;
}

// คำนวณวันหมดสัญญา (เพิ่มปีรับประกัน)
function addYears(date, years) {
  if (typeof date === 'string') date = new Date(date);
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

// คำนวณวันตรวจเช็ครอบถัดไป (เพิ่มเดือน)
function addMonths(date, months) {
  if (typeof date === 'string') date = new Date(date);
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// วันนี้ (เวลา 00:00)
function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ต่างกี่วัน
function daysBetween(a, b) {
  const msPerDay = 86400000;
  const d1 = typeof a === 'string' ? new Date(a) : a;
  const d2 = typeof b === 'string' ? new Date(b) : b;
  return Math.round((d2 - d1) / msPerDay);
}

// สร้าง timestamp ปัจจุบัน
function nowISO() {
  return new Date().toISOString();
}

module.exports = {
  parseThaiDate,
  toISO,
  toThaiDisplay,
  addYears,
  addMonths,
  today,
  daysBetween,
  nowISO,
  BE_OFFSET,
};
