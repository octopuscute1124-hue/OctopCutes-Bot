// V0.2.5 重複內容偵測（checkDuplicate）+ cleanupTrackers 新分支單元測試
// 直接從 bot.js 抽取實際函式，注入可控時間與 trackers 來測。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

function grab(pattern, label) {
  const m = src.match(pattern);
  if (!m) { console.error(`❌ 找不到 ${label}`); process.exit(1); }
  return m[0];
}

let fakeNow = 1700000000000;
class FakeDate {
  static now() { return fakeNow; }
}

// checkDuplicate：依賴全局 trackers 與 Date
const dupCode = grab(/function checkDuplicate\(userId, guildId, content\) \{[\s\S]*?\r?\n\}/, 'checkDuplicate');
const checkDuplicate = new Function('trackers', 'Date', dupCode + '; return checkDuplicate;')(new Map(), FakeDate);

// cleanupTrackers：依賴全局 trackers 與 Date（含 V0.2.5 的 dup_ 分支）
const cleanCode = grab(/function cleanupTrackers\(\) \{[\s\S]*?\r?\n\}/, 'cleanupTrackers');
const cleanupTrackers = new Function('trackers', 'Date', cleanCode + '; return cleanupTrackers;')(new Map(), FakeDate);

let pass = true;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) console.log(`❌ ${label}: 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  else console.log(`✅ ${label}`);
  if (!ok) pass = false;
}

const trackers = new Map();
const cd = new Function('trackers', 'Date', dupCode + '; return checkDuplicate;')(trackers, FakeDate);
const cl = new Function('trackers', 'Date', cleanCode + '; return cleanupTrackers;')(trackers, FakeDate);

// ===== 5 次相同內容 → 觸發 =====
fakeNow += 1000;
let r = null;
for (let i = 0; i < 5; i++) { fakeNow += 500; r = cd('u1', 'g1', '同一句話'); }
check('5 次相同內容觸發', r !== false && r.triggered === true, true);
check('觸發次數為 5', r.count, 5);

// ===== 4 次相同 → 不觸發 =====
trackers.clear();
for (let i = 0; i < 4; i++) { fakeNow += 500; r = cd('u2', 'g1', '四句話'); }
check('4 次相同內容不觸發', r, false);

// ===== 穿插不同內容 → 不觸發 =====
trackers.clear();
const msgs = ['甲', '乙', '丙', '丁', '甲'];
let r2 = false;
for (const m of msgs) { fakeNow += 500; const x = cd('u3', 'g1', m); if (x) r2 = x; }
check('穿插不同內容不觸發', r2, false);

// ===== 30 秒窗口過期 → 重置 =====
trackers.clear();
for (let i = 0; i < 5; i++) { fakeNow += 500; cd('u4', 'g1', '過期測試'); }
fakeNow += 31000; // 超過 30 秒窗口
r = cd('u4', 'g1', '過期測試');
check('30 秒後重置（僅 1 次）', r, false);

// ===== cleanupTrackers：dup_ 過期清理 =====
trackers.clear();
fakeNow += 1000;
for (let i = 0; i < 5; i++) { fakeNow += 500; cd('u5', 'g1', '清理測試'); }
check('dup_ 條目存在', trackers.has('dup_u5_g1'), true);
fakeNow += 70000; // 超過 60 秒無活動
cl();
check('逾 60 秒 dup_ 被清理', trackers.has('dup_u5_g1'), false);

// ===== cleanupTrackers：近期活動保留 =====
trackers.clear();
fakeNow += 1000;
for (let i = 0; i < 5; i++) { fakeNow += 500; cd('u6', 'g1', '保留測試'); }
fakeNow += 10000; // 10 秒前有活動
cl();
check('近期 dup_ 保留', trackers.has('dup_u6_g1'), true);

// ===== cleanupTrackers：msgs 過期但 last 近期 → 保留 =====
trackers.clear();
fakeNow += 1000;
cd('u7', 'g1', '單一訊息');
fakeNow += 10000;
cl();
check('有 last 的 dup_ 保留', trackers.has('dup_u7_g1'), true);

console.log(pass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
process.exit(pass ? 0 : 1);
