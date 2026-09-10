// V0.4.8 測試：處置可撤銷・一鍵還原
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        pass++;
        console.log(`✅ ${name}`);
    } else {
        fail++;
        console.log(`❌ ${name}: 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
    }
}

const undoStart = src.indexOf('// ============ V0.4.8：處置可撤銷');
const undoEnd = src.indexOf('async function showAutoPanel');
if (undoStart === -1 || undoEnd === -1) { console.error('❌ 找不到撤銷區塊'); process.exit(1); }
const undoCode = src.slice(undoStart, undoEnd);
const FakeDate = class { static now() { return 1700000000000; } };

// ===== 1) 撤銷保護 hasUndoProtection =====
function buildUndo(bl) {
    return new Function('loadBlacklist', 'Date', undoCode + '; return { hasUndoProtection, undoPunishment };')(
        () => bl, FakeDate
    );
}
{
    const bl = { actionHistory: [] };
    const u = buildUndo(bl);
    check('無記錄 → 無保護', u.hasUndoProtection('u1', 'g1'), false);
}
{
    const bl = { actionHistory: [
        { kind: 'ban', uid: 'u1', gid: 'g1', at: 1700000000000 - 60000, undone: true },
        { kind: 'ban', uid: 'u1', gid: 'g1', at: 1700000000000 - 60000, undone: false }
    ] };
    const u = buildUndo(bl);
    check('已撤銷（24h 內）→ 有保護', u.hasUndoProtection('u1', 'g1'), true);
    check('未撤銷 → 無保護', u.hasUndoProtection('u2', 'g1'), false);
}
{
    const bl = { actionHistory: [
        { kind: 'timeout', uid: 'u1', gid: 'g1', at: 1700000000000 - 86400000 - 1000, undone: true }
    ] };
    const u = buildUndo(bl);
    check('超過 24h → 無保護', u.hasUndoProtection('u1', 'g1'), false);
}
{
    const bl = { actionHistory: [
        { kind: 'ban', uid: 'u1', gid: 'g2', at: 1700000000000 - 60000, undone: true }
    ] };
    const u = buildUndo(bl);
    check('其他伺服器記錄 → 不保護本服', u.hasUndoProtection('u1', 'g1'), false);
}

// ===== 2) undoPunishment =====
(async () => {
{
    const calls = [];
    const guild = {
        members: {
            unban: async (uid, reason) => { calls.push(['unban', uid]); return {}; },
            fetch: async () => null
        }
    };
    const u = buildUndo({});
    const ok = await u.undoPunishment(guild, { kind: 'ban', uid: 'u1' });
    check('Ban 撤銷成功', ok, true);
    check('呼叫 unban', JSON.stringify(calls), JSON.stringify([['unban', 'u1']]));
}
{
    const calls = [];
    const guild = {
        members: {
            fetch: async () => ({ timeout: async (ms, r) => { calls.push(['timeout', ms]); } }),
            unban: async () => {}
        }
    };
    const u = buildUndo({});
    const ok = await u.undoPunishment(guild, { kind: 'timeout', uid: 'u1' });
    check('Timeout 撤銷成功', ok, true);
    check('呼叫 timeout(null)', JSON.stringify(calls), JSON.stringify([['timeout', null]]));
}
{
    const guild = { members: { fetch: async () => null, unban: async () => { throw new Error('x'); } } };
    const u = buildUndo({});
    const ok = await u.undoPunishment(guild, { kind: 'ban', uid: 'u1' });
    check('撤銷失敗回傳 false', ok, false);
}
})();

// ===== 3) 原始碼整合斷言 =====
{
    const escSeg = src.slice(src.indexOf('async function escalatePunishment'), src.indexOf('async function escalatePunishment') + 2000);
    check('escalatePunishment 含撤銷保護', /hasUndoProtection\(uid, gid\)/.test(escSeg), true);
    check('撤銷保護回傳 warn', /return 'warn'/.test(escSeg), true);
}
{
    check('主面板含撤銷按鈕', src.includes("setCustomId('undo').setLabel('↩️ 處置撤銷')"), true);
    check('switch 含 undo 分派', src.includes("case 'undo':"), true);
    check('互動含 undo_ 前綴處理', src.includes("startsWith('undo_')"), true);
    check('banUser 含處置歷史記錄', /actionHistory.*kind: 'ban'/.test(src), true);
    check('timeout 含處置歷史記錄', /actionHistory.*kind: 'timeout'/.test(src), true);
    check('撤銷寫入 UNDO_PUNISHMENT 日誌', src.includes("logAction('UNDO_PUNISHMENT'"), true);
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
