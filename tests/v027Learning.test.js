// V0.2.7 自主學習引擎單元測試：learnScamDomains（V0.2.8 更新為持久化候選池契約）
// 直接從 bot.js 抽取實際函式（含 OFFICIAL_DOMAINS / getScamCandidates），注入 blacklist/logAction stub 測試。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8');

function grab(pattern, label) {
  const m = src.match(pattern);
  if (!m) { console.error(`❌ 找不到 ${label}`); process.exit(1); }
  return m[0];
}

let pass = true;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) console.log(`❌ ${label}: 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  else console.log(`✅ ${label}`);
  if (!ok) pass = false;
}

// 抽取 OFFICIAL_DOMAINS、getScamCandidates、learnScamDomains，組合成可注入環境的函式
const official = grab(/const OFFICIAL_DOMAINS = \[[\s\S]*?\];/, 'OFFICIAL_DOMAINS');
const candCode = grab(/function getScamCandidates\(\) \{[\s\S]*?\r?\n\}/, 'getScamCandidates');
const learnCode = grab(/function learnScamDomains\(\) \{[\s\S]*?\r?\n\}/, 'learnScamDomains');
const tierCode = grab(/function assessLearningTier[\s\S]*?\r?\n\}/, 'assessLearningTier');
const code = [tierCode, official, candCode, learnCode, 'return learnScamDomains;'].join('\n');

// 建立學習環境：注入 loadBlacklist/saveBlacklist/logAction
// loadBlacklist 必須回傳同一共享物件（模擬真實 blacklistCache），
// 候選池從 bl.scamCandidateStats 讀取（V0.2.8 持久化契約）。
function buildEnv(domains, meta, candidates, logFn) {
  const bl = { scamDomains: domains, scamDomainMeta: meta, scamCandidateStats: candidates };
  const actions = [];
  const learn = new Function('loadBlacklist', 'saveBlacklist', 'logAction', code)(
    () => bl,
    (d) => actions.push(['save', d.scamDomains.length]),
    logFn || ((a, d) => actions.push([a, d && d.domain]))
  );
  return { learn, actions, bl };
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// ===== 場景 1：偽官方域名命中 3 次 → 自動加入 =====
{
  const domains = [];
  const meta = {};
  const candidates = { 'discord-verify.xyz': { count: 3, firstHit: now - 1000, lastHit: now, sources: ['g1', 'g2'] } };
  const { learn, actions } = buildEnv(domains, meta, candidates);
  const r = learn();
  check('命中 3 次自動加入', domains.includes('discord-verify.xyz'), true);
  check('來源為自主學習', meta['discord-verify.xyz'].source, '自主學習');
  check('回報次數=命中次數', meta['discord-verify.xyz'].reports, 3);
  check('返回 learned=1', r.learned, 1);
  check('已學習候選被移除', 'discord-verify.xyz' in candidates, false);
  check('有儲存黑名單', actions.some(a => a[0] === 'save'), true);
  check('記錄學習事件', actions.some(a => a[0] === 'SCAM_LEARN'), true);
}

// ===== 場景 2：命中 2 次 → 不加入且候選保留 =====
{
  const domains = [];
  const meta = {};
  const candidates = { 'discord-gift.xyz': { count: 2, firstHit: now - 1000, lastHit: now } };
  const { learn, actions } = buildEnv(domains, meta, candidates);
  const r = learn();
  check('命中 2 次不加入', domains.includes('discord-gift.xyz'), false);
  check('learned=0', r.learned, 0);
  check('未達標候選保留', 'discord-gift.xyz' in candidates, true);
  check('不儲存', actions.some(a => a[0] === 'save'), false);
}

// ===== 場景 3：官方域名即使進學習池也不加入 =====
{
  const domains = [];
  const meta = {};
  const candidates = { 'discord.com': { count: 99, lastHit: now } };
  const { learn, bl } = buildEnv(domains, meta, candidates);
  const r = learn();
  check('官方域名永不加入', domains.includes('discord.com'), false);
}

// ===== 場景 4：加入 14 天零命中 → 低置信移除；有命中保留 =====
{
  const domains = ['old-scam.com', 'active-scam.com'];
  const meta = {
    'old-scam.com': { reports: 1, hits: 0, addedAt: now - 15 * DAY, source: '管理員回報' },
    'active-scam.com': { reports: 1, hits: 5, addedAt: now - 15 * DAY, source: '管理員回報' }
  };
  const { learn, actions, bl } = buildEnv(domains, meta, {});
  const r = learn();
  check('14 天零命中被移除', bl.scamDomains.includes('old-scam.com'), false);
  check('有命中的保留', bl.scamDomains.includes('active-scam.com'), true);
  check('meta 同步刪除', meta['old-scam.com'] === undefined, true);
  check('removed=1', r.removed, 1);
  check('記錄移除事件', actions.some(a => a[0] === 'SCAM_FORGET'), true);
}

// ===== 場景 5：加入不到 14 天零命中 → 保留 =====
{
  const domains = ['recent-scam.com'];
  const meta = { 'recent-scam.com': { reports: 1, hits: 0, addedAt: now - 3 * DAY, source: '管理員回報' } };
  const { learn, bl } = buildEnv(domains, meta, {});
  const r = learn();
  check('3 天零命中保留', bl.scamDomains.includes('recent-scam.com'), true);
  check('removed=0', r.removed, 0);
}

// ===== 場景 6：多個達標候選一次學習，學習後候選全部移除 =====
{
  const domains = [];
  const meta = {};
  const candidates = { 'steam-free.xyz': { count: 3, lastHit: now, sources: ['g1', 'g2'] }, 'nitro-gift.xyz': { count: 3, lastHit: now, sources: ['g1', 'g2'] } };
  const { learn, bl } = buildEnv(domains, meta, candidates);
  const r = learn();
  check('學習後候選已清空', Object.keys(candidates).length, 0);
  check('兩個都加入', domains.includes('steam-free.xyz') && domains.includes('nitro-gift.xyz'), true);
  check('learned=2', r.learned, 2);
}

// ===== 場景 7（V0.2.8）：候選超過 72 小時未命中 → 老化清除 =====
{
  const domains = [];
  const meta = {};
  const candidates = {
    'stale-cand.xyz': { count: 2, firstHit: now - 100 * DAY, lastHit: now - 80 * DAY },
    'fresh-cand.xyz': { count: 2, firstHit: now - 100 * DAY, lastHit: now - 1000 }
  };
  const { learn, actions } = buildEnv(domains, meta, candidates);
  const r = learn();
  check('過期候選被老化清除', 'stale-cand.xyz' in candidates, false);
  check('近期候選保留', 'fresh-cand.xyz' in candidates, true);
  check('回傳 forgotten=1', r.forgotten, 1);
  check('有儲存（老化清除也算變更）', actions.some(a => a[0] === 'save'), true);
}

console.log(pass ? '========== 全部通過 ==========' : '========== 有失敗 ==========');
process.exit(pass ? 0 : 1);
