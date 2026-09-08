// 驗證 bot.js 的 scheduleSave / flushPendingWrites 防抖寫入邏輯（V0.2.4）
// 直接從 bot.js 抽取實際函式，注入假的 fs 與 setTimeout 做確定性測試。
const fs = require('fs');
const path = require('path');
const os = require('os');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

function extract(fnName) {
  const re = new RegExp(`function ${fnName}\\s*\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`, '');
  const m = src.match(re);
  if (!m) { console.error(`❌ 找不到 ${fnName} 函式`); process.exit(1); }
  return m[0];
}

let allPass = true;
function assert(name, cond) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) allPass = false;
}

async function main() {
  // 測試 1：同檔多次排程會合併成一次寫入，且寫入的是最新資料
  {
    const written = [];
    let timerCbs = [];
    const pendingWrites = new Map();
    const fakeFs = { writeFileSync: (f, c) => written.push({ f, c }) };
    const fakeSetTimeout = (cb) => { timerCbs.push(cb); return timerCbs.length; };
    const code = extract('scheduleSave') + extract('flushPendingWrites') +
      '; return { scheduleSave, flushPendingWrites };';
    const { scheduleSave, flushPendingWrites } =
      new Function('fs', 'setTimeout', 'pendingWrites', code)(fakeFs, fakeSetTimeout, pendingWrites);

    scheduleSave('logs.json', { v: 1 }, 800);
    scheduleSave('logs.json', { v: 2 }, 800);
    scheduleSave('logs.json', { v: 3 }, 800);
    assert('同檔 3 次排程只建立 1 個計時器', timerCbs.length === 1);

    timerCbs.shift()(); // 觸發寫入
    assert('寫入 1 次且內容為最新資料', written.length === 1 && JSON.parse(written[0].c).v === 3);
    assert('寫入後 pendingWrites 已清空', pendingWrites.size === 0);

    // 測試 2：不同檔案各自排程
    scheduleSave('a.json', { x: 1 }, 800);
    scheduleSave('b.json', { y: 2 }, 800);
    assert('不同檔案各自建立計時器', timerCbs.length === 2);

    // 測試 3：flushPendingWrites 強制寫出並清空
    scheduleSave('c.json', { z: 3 }, 800);
    flushPendingWrites();
    const last = written[written.length - 1];
    assert('flush 強制寫出未排程檔案', last.f === 'c.json' && JSON.parse(last.c).z === 3);
    assert('flush 後 pendingWrites 清空', pendingWrites.size === 0);
  }

  // 測試 4：logAction 串接（含防抖寫入）— 用真 fs 在暫存目錄驗證
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botlog-'));
    const LOG_FILE = path.join(tmp, 'logs.json');
    const getLogsCode = src.match(/function getLogs\(\) \{[\s\S]*?\n\}/)[0];
    const schedCode = src.match(/function scheduleSave\(file, data, delayMs = 800\) \{[\s\S]*?\n\}/)[0];
    const logCode = src.match(/function logAction\(action, details\) \{[\s\S]*?\n\}/)[0];
    const { logAction } = new Function(
      'LOG_FILE', 'fs', 'setTimeout', 'loadJSON',
      'let logsBuffer = null; let pendingWrites = new Map();' +
      getLogsCode + schedCode + logCode + '; return { logAction };'
    )(LOG_FILE, fs, setTimeout, (f, fb) => {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; }
    });
    logAction('TEST_A', { x: 1 });
    logAction('TEST_B', { x: 2 });
    await new Promise(r => setTimeout(r, 1200));
    const saved = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    assert('logAction 防抖寫入 2 筆', Array.isArray(saved) && saved.length === 2);
    assert('內容正確', saved[0].action === 'TEST_A' && saved[1].action === 'TEST_B');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(allPass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
  process.exit(allPass ? 0 : 1);
}

main();
