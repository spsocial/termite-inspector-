const cron = require('node-cron');
const sheets = require('./googleSheets');
const telegram = require('./telegram');
const config = require('../config');
const { today, daysBetween, toThaiDisplay } = require('../utils/dateUtils');

function startCronJobs() {
  // ทุกเช้า 08:00 น. (เวลาไทย UTC+7 = 01:00 UTC)
  cron.schedule('0 1 * * *', async () => {
    console.log('[Cron] Daily summary running...');
    try {
      await sendDailySummary();
    } catch (err) {
      console.error('[Cron] Daily summary error:', err.message);
    }
  });

  // ทุกวันจันทร์ 08:00 น.
  cron.schedule('0 1 * * 1', async () => {
    console.log('[Cron] Weekly summary running...');
    try {
      await sendWeeklySummary();
    } catch (err) {
      console.error('[Cron] Weekly summary error:', err.message);
    }
  });

  // ทุก 6 ชั่วโมง อัพเดทสถานะ overdue
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Cron] Updating overdue statuses...');
    try {
      await updateOverdueStatuses();
    } catch (err) {
      console.error('[Cron] Overdue update error:', err.message);
    }
  });

  console.log('[Cron] Jobs scheduled');
}

async function sendDailySummary() {
  const [custRows, inspRows] = await Promise.all([
    sheets.getRows(config.sheets.customers),
    sheets.getRows(config.sheets.inspections),
  ]);

  const now = today();
  const customers = custRows.slice(1);
  const inspections = inspRows.slice(1);

  let overdueCount = 0;
  let todayCount = 0;
  let weekCount = 0;
  const overdueList = [];
  const todayList = [];

  inspections.forEach(row => {
    if (row[5] === 'completed') return;
    const dueDate = row[3] ? new Date(row[3]) : null;
    if (!dueDate) return;
    const days = daysBetween(now, dueDate);

    const customer = customers.find(c => c[0] === row[1]);
    const name = customer ? customer[1] : row[1];

    if (days < 0) {
      overdueCount++;
      if (overdueList.length < 5) {
        overdueList.push(`  • ${name} (รอบ ${row[2]}, เกิน ${Math.abs(days)} วัน)`);
      }
    } else if (days === 0) {
      todayCount++;
      todayList.push(`  • ${name} (รอบ ${row[2]})`);
    } else if (days <= 7) {
      weekCount++;
    }
  });

  // สัญญาใกล้หมด
  let expiringCount = 0;
  customers.forEach(row => {
    if (row[11] !== 'active') return;
    const contractEnd = row[8] ? new Date(row[8]) : null;
    if (!contractEnd) return;
    const days = daysBetween(now, contractEnd);
    if (days >= 0 && days <= 30) expiringCount++;
  });

  const dateStr = toThaiDisplay(now);
  let msg = `📋 <b>สรุปงานวันนี้ (${dateStr})</b>\n\n`;
  msg += `🔴 เกินกำหนด: ${overdueCount} ราย\n`;
  msg += `🟡 ต้องตรวจวันนี้: ${todayCount} ราย\n`;
  msg += `🟢 ใกล้ถึงกำหนด (7 วัน): ${weekCount} ราย\n`;
  msg += `📊 สัญญาใกล้หมด (30 วัน): ${expiringCount} ราย\n`;

  if (overdueList.length > 0) {
    msg += `\n🔴 <b>เกินกำหนด:</b>\n${overdueList.join('\n')}`;
    if (overdueCount > 5) msg += `\n  ... และอีก ${overdueCount - 5} ราย`;
  }
  if (todayList.length > 0) {
    msg += `\n\n🟡 <b>ต้องตรวจวันนี้:</b>\n${todayList.join('\n')}`;
  }

  await telegram.sendMessage(msg);
}

async function sendWeeklySummary() {
  const [custRows, inspRows] = await Promise.all([
    sheets.getRows(config.sheets.customers),
    sheets.getRows(config.sheets.inspections),
  ]);

  const now = today();
  const customers = custRows.slice(1);
  const inspections = inspRows.slice(1);

  // สถิติสัปดาห์ที่ผ่านมา
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  let completedThisWeek = 0;
  inspections.forEach(row => {
    if (row[5] === 'completed' && row[4]) {
      const actual = new Date(row[4]);
      if (actual >= weekAgo && actual <= now) {
        completedThisWeek++;
      }
    }
  });

  const overdueCount = inspections.filter(row => {
    if (row[5] === 'completed') return false;
    const dueDate = row[3] ? new Date(row[3]) : null;
    return dueDate && dueDate < now;
  }).length;

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const upcomingCount = inspections.filter(row => {
    if (row[5] === 'completed') return false;
    const dueDate = row[3] ? new Date(row[3]) : null;
    return dueDate && dueDate >= now && dueDate <= nextWeek;
  }).length;

  let msg = `📊 <b>สรุปประจำสัปดาห์</b>\n\n`;
  msg += `✅ ตรวจเสร็จสัปดาห์นี้: ${completedThisWeek} ราย\n`;
  msg += `🔴 เกินกำหนดคงค้าง: ${overdueCount} ราย\n`;
  msg += `📅 ต้องตรวจสัปดาห์หน้า: ${upcomingCount} ราย\n`;
  msg += `👥 ลูกค้าทั้งหมด: ${customers.length} ราย`;

  await telegram.sendMessage(msg);
}

async function updateOverdueStatuses() {
  const inspRows = await sheets.getRows(config.sheets.inspections);
  const now = today();
  let updated = 0;

  for (let i = 1; i < inspRows.length; i++) {
    const row = inspRows[i];
    if (row[5] === 'pending' && row[3]) {
      const dueDate = new Date(row[3]);
      if (dueDate < now) {
        row[5] = 'overdue';
        await sheets.updateRow(config.sheets.inspections, i + 1, row);
        updated++;
      }
    }
  }

  if (updated > 0) {
    console.log(`[Cron] Updated ${updated} inspections to overdue`);
  }
}

module.exports = { startCronJobs, sendDailySummary, sendWeeklySummary };
