// V0.4.7 測試：智慧裁定・攻擊者圖譜
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

const gStart = src.indexOf('// ============ V0.4.7：攻擊者圖譜');
const gEnd = src.indexOf('const OFFICIAL_DOMAINS = [');
if (gStart === -1 || gEnd === -1) { console.error('❌ 找不到攻擊者圖譜'); process.exit(1); }
const gCode = src.slice(gStart, gEnd);
const smStart = src.indexOf('function smartAdjudicate');
const smEnd = src.indexOf('// 半衰期 10 分鐘');
const smCode = src.slice(smStart, smEnd);

// ===== 1) 攻擊者圖譜 =====
const shared = {};
const graph = new Function('loadBlacklist', 'saveBlacklist', 'Date', gCode + '; return { recordAttackLink, getAttackProfile };')(
    () => shared, (d) => { shared.__saved = true; }, class { static now() { return 1700000000000; } }
);
{
    check('無資料：非攻擊者', JSON.stringify(graph.getAttackProfile('u9')), JSON.stringify({ domainCount: 0, isAttacker: false, escalation: 0 }));
    const c1 = graph.recordAttackLink('u1', 'evil1.xyz');
    check('首次記錄回傳 1', c1, 1);
    const c2 = graph.recordAttackLink('u1', 'evil2.xyz');
    check('第二域名回傳 2', c2, 2);
    const prof = graph.getAttackProfile('u1');
    check('2 域名 → 攻擊者', prof.isAttacker, true);
    check('2 域名 → escalation 1', prof.escalation, 1);
    const c3 = graph.recordAttackLink('u1', 'evil3.xyz');
    check('第三域名回傳 3', c3, 3);
    check('3 域名 → escalation 2（嚴重）', graph.getAttackProfile('u1').escalation, 2);
    check('重複域名不重複計', graph.recordAttackLink('u1', 'evil1.xyz'), 3);
    check('圖譜已持久化', shared.__saved, true);
    check('圖譜含 3 域名', shared.attackGraph.u1.domains.length, 3);
}

// ===== 2) 智慧裁定（中性環境＝原邏輯） =====
function buildAdj(profile, rep, tier) {
    const bl = { guildReputations: {}, scamDomainMeta: {}, rejectedDomains: {} };
    return new Function('getAttackProfile', 'getGuildReputation', 'assessLearningTier', 'loadBlacklist', smCode + '; return smartAdjudicate;')(
        () => profile, (b, gid) => rep, () => tier, () => bl
    );
}
{
    const adj = buildAdj({ domainCount: 0, isAttacker: false, escalation: 0 }, 0.5, 'normal');
    check('中性：風險 12 → ban', adj('scam', 'u1', 'g1', 12).level, 'ban');
    check('中性：風險 7 → timeout', adj('scam', 'u1', 'g1', 7).level, 'timeout');
    check('中性：風險 3 → warn', adj('scam', 'u1', 'g1', 3).level, 'warn');
}

// ===== 3) 慣犯升級 =====
{
    const adj = buildAdj({ domainCount: 2, isAttacker: true, escalation: 1 }, 0.5, 'normal');
    check('慣犯：warn 升級 timeout', adj('scam', 'u1', 'g1', 3).level, 'timeout');
    const adj2 = buildAdj({ domainCount: 4, isAttacker: true, escalation: 2 }, 0.5, 'normal');
    const r = adj2('scam', 'u1', 'g1', 3);
    check('嚴重慣犯：直接 ban', r.level, 'ban');
    check('嚴重慣犯附註原因', r.note.includes('圖譜'), true);
}

// ===== 4) 低信譽伺服器降級（非攻擊者，防帶風向） =====
{
    const adj = buildAdj({ domainCount: 0, isAttacker: false, escalation: 0 }, 0.3, 'normal');
    check('低信譽：ban 降 timeout', adj('scam', 'u1', 'g1', 12).level, 'timeout');
    check('低信譽：timeout 降 warn', adj('scam', 'u1', 'g1', 7).level, 'warn');
    const adjHi = buildAdj({ domainCount: 0, isAttacker: false, escalation: 0 }, 0.7, 'normal');
    check('高信譽：ban 維持', adjHi('scam', 'u1', 'g1', 12).level, 'ban');
    // 攻擊者不受低信譽降級保護
    const adjAtt = buildAdj({ domainCount: 3, isAttacker: true, escalation: 2 }, 0.3, 'normal');
    check('攻擊者在低信譽服仍 ban', adjAtt('scam', 'u1', 'g1', 3).level, 'ban');
}

// ===== 5) 學習品質 strict 升級 =====
{
    const adj = buildAdj({ domainCount: 0, isAttacker: false, escalation: 0 }, 0.7, 'strict');
    check('strict：warn 升級 timeout', adj('scam', 'u1', 'g1', 3).level, 'timeout');
    check('strict：timeout 升級 ban', adj('scam', 'u1', 'g1', 7).level, 'ban');
}

// ===== 6) 非詐騙類訊號不受信譽影響 =====
{
    const adj = buildAdj({ domainCount: 0, isAttacker: false, escalation: 0 }, 0.3, 'strict');
    check('mention 低信譽不降級', adj('mention', 'u1', 'g1', 12).level, 'ban');
    check('mention strict 不升級', adj('mention', 'u1', 'g1', 3).level, 'warn');
}

console.log(`\n========== ${fail === 0 ? '全部通過' : '有失敗'}（${pass} 通過 / ${fail} 失敗）==========`);
process.exit(fail === 0 ? 0 : 1);
