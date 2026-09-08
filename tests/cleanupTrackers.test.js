// 驗證 bot.js 的 cleanupTrackers 記憶體洩漏修復（V0.2.3）
// 直接從 bot.js 抽取實際函式來測試，避免測試與實作脫節。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');
const m = src.match(/function cleanupTrackers\(\) \{[\s\S]*?\n\}/);
if (!m) { console.error('❌ 找不到 cleanupTrackers 函式'); process.exit(1); }

const trackers = new Map();
// 以 new Function 包裝：cleanupTrackers 會閉包捕捉這兩個參數
const cleanupTrackers = new Function('trackers', 'Date', m[0] + '; return cleanupTrackers;')(trackers, Date);

const now = Date.now();
const MIN = 60000, STRIKE_WIN = 600000;

// 建立各種型態的追蹤器條目
function seed() {
  trackers.clear();
  // 間隔型（checkInterval）— 應清理
  trackers.set('flood_u1_g1', { times: [now - 120000], last: now - 120000 });
  // 間隔型 — 近期活動，應保留
  trackers.set('flood_u2_g1', { times: [now - 5000], last: now - 5000 });
  // strike 型 — 超過 10 分鐘，應清理
  trackers.set('strike_xss_u3_g1', { count: 1, last: now - STRIKE_WIN - 1000 });
  // strike 型 — 10 分鐘內，應保留
  trackers.set('strike_xss_u4_g1', { count: 1, last: now - 10000 });
  // brute 型 — 已封鎖且到期，應清理
  trackers.set('brute_u5', { attempts: [now - 70000], blocked: true, until: now - 1000 });
  // brute 型 — 已封鎖未到期，應保留
  trackers.set('brute_u6', { attempts: [now], blocked: true, until: now + 120000 });
  // brute 型 — 未封鎖且 attempts 過期為空，應清理
  trackers.set('brute_u7', { attempts: [now - 70000], blocked: false, until: 0 });
  // brute 型 — 未封鎖但有近期嘗試，應保留
  trackers.set('brute_u8', { attempts: [now - 1000], blocked: false, until: 0 });
  // behavior 型 — 過期，應清理
  trackers.set('behavior_u9', { actions: [now - 70000], last: now - 70000 });
  // behavior 型 — 近期，應保留
  trackers.set('behavior_u10', { actions: [now - 1000], last: now - 1000 });
  // rl 型 — 已過重置時間，應清理
  trackers.set('rl_u11', { count: 5, reset: now - 1000 });
  // rl 型 — 未到期，應保留
  trackers.set('rl_u12', { count: 5, reset: now + 30000 });
  // 未知型態 — 長期無更新，應清理（保險）
  trackers.set('weird_u13', { last: now - 700000 });
  // 未知型態 — 近期更新，應保留
  trackers.set('weird_u14', { last: now - 1000 });
  // 空資料 — 應清理
  trackers.set('empty_u15', null);
}

function run() {
  seed();
  cleanupTrackers();
  const expected = new Set([
    'flood_u2_g1', 'strike_xss_u4_g1', 'brute_u6', 'brute_u8',
    'behavior_u10', 'rl_u12', 'weird_u14'
  ]);
  let pass = true;
  for (const [k, v] of trackers) {
    if (!expected.has(k)) { console.log(`❌ 不應保留: ${k}`); pass = false; }
  }
  for (const k of expected) {
    if (!trackers.has(k)) { console.log(`❌ 應保留卻被刪除: ${k}`); pass = false; }
  }
  return pass;
}

// 多輪執行，確認不會殘留
let allPass = true;
for (let i = 0; i < 5; i++) {
  const r = run();
  console.log(`第 ${i + 1} 輪: ${r ? '✅ 通過' : '❌ 失敗'}`);
  if (!r) allPass = false;
}

// 壓力：模擬大量條目後全部過期，確認 Map 能歸零
trackers.clear();
for (let i = 0; i < 5000; i++) {
  trackers.set(`strike_xss_u${i}_g`, { count: 2, last: now - 700000 });
  trackers.set(`brute_u${i}`, { attempts: [now - 70000], blocked: false, until: 0 });
  trackers.set(`rl_u${i}`, { count: 1, reset: now - 1 });
  trackers.set(`behavior_u${i}`, { actions: [now - 70000], last: now - 70000 });
}
cleanupTrackers();
if (trackers.size === 0) { console.log('✅ 壓力測試：20000 條過期條目全數清除'); }
else { console.log(`❌ 壓力測試：仍有 ${trackers.size} 條殘留`); allPass = false; }

console.log(allPass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
process.exit(allPass ? 0 : 1);
