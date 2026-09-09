require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, PermissionFlagsBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildWebhooks,
    ]
});

const DEVELOPER_ID = process.env.DEVELOPER_ID;

// V0.3.2：底層 REST 速率限制監控——429 時 discord.js 已自動退避，此處僅記錄供追查
client.rest.on('rateLimited', (info) => {
    writeCrash('rateLimited', new Error(`REST ${info.route} 429，重試 ${info.retryAfter}ms 後`));
});

// V0.3.0：資料檔一律以 __dirname 定位——從任何目錄啟動都不會寫錯位置
const DATA_DIR = __dirname;
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOG_FILE = path.join(DATA_DIR, 'logs.json');

// ============ 工具函數 ============
// V0.3.3：原型污染消毒——JSON 載入時剝離 __proto__/constructor/prototype 鍵
// 攻擊者若竄改資料檔寫入 __proto__ 鍵，JSON.parse 後可能污染物件原型造成注入
function sanitizeJSON(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return obj;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) obj[i] = sanitizeJSON(obj[i], depth + 1);
        return obj;
    }
    for (const k of Object.keys(obj)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
            delete obj[k];
            continue;
        }
        obj[k] = sanitizeJSON(obj[k], depth + 1);
    }
    return obj;
}

function loadJSON(file, fallback) {
    try {
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf8');
            const data = JSON.parse(raw);
            if (typeof data !== 'object' || data === null) throw new Error('JSON 根節點非物件');
            // V0.3.3：原型污染消毒
            return sanitizeJSON(data);
        }
    } catch (e) {
        console.error(`讀取 ${file} 失敗:`, e.message);
        // V0.2.5：損壞的設定檔自動備份為 .corrupt-<時間戳>，避免被竄改或手動誤改後資料永久遺失
        try {
            const bak = `${file}.corrupt-${Date.now()}`;
            fs.copyFileSync(file, bak);
            console.warn(`⚠️ 已備份損壞檔案: ${bak}`);
        } catch (_) {}
    }
    return fallback;
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        console.log(`✅ ${file} 已儲存`);
        return true;
    } catch (e) { console.error(`儲存 ${file} 失敗:`, e.message); return false; }
}

// ============ 黑名單 ============
// V0.2.4：黑名單改用記憶體快取，避免每次操作都重新讀檔；寫入維持同步以確保安全
let blacklistCache = null;
function loadBlacklist() {
    if (!blacklistCache) {
        const d = loadJSON(BLACKLIST_FILE, { bannedUsers: [], records: {} });
        // V0.2.5：結構保險——即使 JSON 合法但結構不完整也不會崩潰
        if (!Array.isArray(d.bannedUsers)) d.bannedUsers = [];
        if (!d.records || typeof d.records !== 'object') d.records = {};
        // V0.2.6：管理員自訂詐騙域名清單
        if (!Array.isArray(d.scamDomains)) d.scamDomains = [];
        // V0.2.7：詐騙域名學習紀錄（回報次數/命中次數/來源）
        if (!d.scamDomainMeta || typeof d.scamDomainMeta !== 'object') d.scamDomainMeta = {};
        // V0.2.8：詐騙學習候選池（持久化，重啟不丟學習進度）
        if (!d.scamCandidateStats || typeof d.scamCandidateStats !== 'object') d.scamCandidateStats = {};
        blacklistCache = d;
    }
    return blacklistCache;
}
function saveBlacklist(data) { blacklistCache = data; saveJSON(BLACKLIST_FILE, data); }

function addToBlacklist(userId, meta = {}) {
    const data = loadBlacklist();
    if (!data.bannedUsers.includes(userId)) {
        data.bannedUsers.push(userId);
        data.records = data.records || {};
        data.records[userId] = {
            reason: meta.reason || '未知',
            sourceGuildId: meta.guildId || null,
            sourceGuildName: meta.guildName || null,
            timestamp: new Date().toISOString()
        };
        saveBlacklist(data);
        return true;
    }
    return false;
}

function removeFromBlacklist(userId) {
    const data = loadBlacklist();
    const idx = data.bannedUsers.indexOf(userId);
    if (idx !== -1) { data.bannedUsers.splice(idx, 1); saveBlacklist(data); return true; }
    return false;
}

// ============ Config ============
const config = { whitelist: { users: [], roles: [] }, security: {}, alert: {}, alertChannel: {}, autoResponses: {} };

function getDefaultSecurity() {
    return {
        stopLoss: true, mentionSpeed: true, scriptDetection: true, voiceAbuse: true,
        webhookMonitor: true, selfbotDetection: true, floodProtection: true, floodJoin: true,
        permissionSpam: true, maliciousFile: true, xssProtection: true, richPresence: true,
        crawlerDetection: true, collusionAttack: true, suspiciousAccount: true, bruteForce: true,
        rateLimit: true, autoDegrade: true, inviteMonitor: true,
        roleLock: true, channelSpam: true, honorGlobalBlacklist: true, logRetention: 30,
        // V0.2.5 新增：詐騙連結攔截 / 重複內容偵測 / 假冒名稱偵測
        scamLink: true, duplicateSpam: true, impersonation: true,
        // V0.2.6 新增：@everyone/@here 濫用防護
        mentionSpam: true,
        // V0.3.3 新增：進階注入偵測（SQL/命令/模板）
        injectionDetection: true
    };
}

function getDefaultAlert() {
    return {
        suspiciousAccount: true, floodJoin: true, webhookAbuse: true, permissionAbuse: true,
        botBanned: true, channelSpam: true, roleAbuse: true, inviteAbuse: true, richPresence: true,
        contentAbuse: true
    };
}

function loadConfig() {
    const raw = loadJSON(CONFIG_FILE, null);
    if (raw) {
        Object.assign(config.whitelist, raw.whitelist || { users: [], roles: [] });
        Object.assign(config.alertChannel, raw.alertChannelId || {});
        Object.assign(config.autoResponses, raw.autoResponses || {});
        // 合併安全設定
        for (const [gid, s] of Object.entries(raw.securitySettings || {})) {
            const merged = { ...getDefaultSecurity(), ...s };
            // 清除已移除的舊開關（V0.2.2 起已不再被程式碼讀取）
            for (const stale of ['commandWhitelist']) delete merged[stale];
            config.security[gid] = merged;
        }
        for (const [gid, a] of Object.entries(raw.alertSettings || {})) {
            config.alert[gid] = { ...getDefaultAlert(), ...a };
        }
    }
}

function saveConfig() {
    saveJSON(CONFIG_FILE, {
        whitelist: config.whitelist,
        securitySettings: config.security,
        alertSettings: config.alert,
        alertChannelId: config.alertChannel,
        autoResponses: config.autoResponses
    });
}

function getSecurity(guildId) {
    if (!config.security[guildId]) config.security[guildId] = getDefaultSecurity();
    return config.security[guildId];
}

function getAlert(guildId) {
    if (!config.alert[guildId]) config.alert[guildId] = getDefaultAlert();
    return config.alert[guildId];
}

function setSecurity(guildId, key, val) {
    const s = getSecurity(guildId);
    s[key] = val;
    saveConfig();
}

function setAlert(guildId, key, val) {
    const a = getAlert(guildId);
    a[key] = val;
    saveConfig();
}

function isWhitelisted(member) {
    const w = config.whitelist;
    if (w.users.includes(member.id)) return true;
    for (const roleId of w.roles) {
        if (member.roles.cache.has(roleId)) return true;
    }
    return false;
}

function isSecEnabled(guildId, feature) {
    const s = getSecurity(guildId);
    return s[feature] !== undefined ? s[feature] : true;
}

function isAlertEnabled(guildId, feature) {
    const a = getAlert(guildId);
    return a[feature] !== undefined ? a[feature] : true;
}

async function sendAlert(guildId, embed) {
    const cid = config.alertChannel[guildId];
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = cid ? guild.channels.cache.get(cid) : guild.systemChannel;
    if (channel) await channel.send({ embeds: [embed] });
}

// ============ 日誌 ============
// V0.2.4：日誌改為記憶體緩衝 + 防抖寫入（scheduleSave），
// 避免每次動作都同步讀寫整份檔案，減少 SD 卡寫入次數與事件迴圈阻塞；
// 程序結束（SIGTERM/SIGINT/例外）前會強制寫出未落盤的資料。
let logsBuffer = null;
const pendingWrites = new Map();

function getLogs() {
    if (!logsBuffer) logsBuffer = loadJSON(LOG_FILE, []);
    return logsBuffer;
}

function scheduleSave(file, data, delayMs = 800) {
    const existing = pendingWrites.get(file);
    if (existing) { existing.data = data; return; }
    const timer = setTimeout(() => {
        // 讀取 map 條目的最新資料（閉包內的 data 是首次呼叫的舊參數）
        const entry = pendingWrites.get(file);
        pendingWrites.delete(file);
        if (!entry) return;
        try {
            fs.writeFileSync(file, JSON.stringify(entry.data, null, 2));
            console.log(`✅ ${file} 已儲存`);
        } catch (e) { console.error(`儲存 ${file} 失敗:`, e.message); }
    }, delayMs);
    pendingWrites.set(file, { data, timer });
}

function flushPendingWrites() {
    for (const [file, { data }] of pendingWrites) {
        try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
        catch (e) { console.error(`寫出 ${file} 失敗:`, e.message); }
    }
    pendingWrites.clear();
}

// ============ V0.2.6 Token 遮罩 ============
// 任何輸出/日誌中出現 DISCORD_TOKEN 時替換為遮罩，防止 crash.log 或控制台外洩 bot token
function maskToken(text) {
    const tok = process.env.DISCORD_TOKEN;
    if (!tok || text == null) return text;
    const s = String(text);
    return s.indexOf(tok) !== -1 ? s.split(tok).join(`tk***(${tok.length}字元)`) : s;
}

function logAction(action, details) {
    const logs = getLogs();
    logs.push({ timestamp: new Date().toISOString(), action, details });
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    logsBuffer = logs.filter(l => new Date(l.timestamp).getTime() > cutoff).slice(-5000);
    scheduleSave(LOG_FILE, logsBuffer);
}

function logAdmin(interaction, action, target) {
    logAction('ADMIN_ACTION', {
        adminId: interaction.user.id,
        adminTag: interaction.user.tag,
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        action,
        target
    });
    console.log(`📝 ${interaction.user.tag} -> ${action} ${target}`);
}

// ============ Ban 函數 ============
async function banUser(member, reason, logReason, channel = null, proposeGlobal = true) {
    try {
        // V0.2.3：discord.js v14.14+ 已棄用 deleteMessageDays，改用 deleteMessageSeconds（7 天 = 604800 秒）
        await member.ban({ reason, deleteMessageSeconds: 604800 });
        // V0.3.2：全域黑名單管理員同意制——不再自動加入，改為發送提名確認
        let proposed = false;
        if (proposeGlobal) proposed = await proposeGlobalBan(member, logReason, channel);
        logAction('BAN', {
            userId: member.id,
            userTag: member.user.tag,
            guildId: member.guild.id,
            guildName: member.guild.name,
            channelId: channel?.id || null,
            reason: logReason
        });
        console.log(`🔨 Ban ${member.user.tag}`);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('🔨 防護觸發')
                .setDescription(`**${member.user.tag}** 已被 Ban`)
                .addFields(
                    { name: '原因', value: logReason, inline: true },
                    { name: '全域黑名單', value: proposed ? '⏳ 待管理員確認' : '已確認，無需提名', inline: true },
                    { name: '時間', value: new Date().toLocaleString(), inline: true }
                );
            await channel.send({ embeds: [embed] });
        }
        return true;
    } catch (e) {
        console.error(`Ban 失敗 (${member.user.tag}):`, e.message);
        return false;
    }
}

// 累犯計數：10 分鐘內同一使用者同一類型第 2 次觸犯才會被封鎖，降低單次誤判就永久 Ban 的風險
function addStrike(userId, guildId, kind) {
    const key = `strike_${kind}_${userId}_${guildId}`;
    const now = Date.now();
    if (!trackers.has(key) || now - trackers.get(key).last > 600000) {
        trackers.set(key, { count: 0, last: now });
    }
    const d = trackers.get(key);
    d.count++;
    d.last = now;
    return d.count;
}

async function warnUser(member, channel, reason, tag) {
    try { await member.timeout(10 * 60 * 1000, `🐙 警告 - ${tag}`); } catch (_) {}
    logAction('WARNING', {
        userId: member.id,
        userTag: member.user.tag,
        guildId: member.guild.id,
        guildName: member.guild.name,
        reason: `${tag} - ${reason}`
    });
    console.log(`⚠️ 警告 ${member.user.tag}: ${tag}`);
    if (channel) {
        const embed = new EmbedBuilder()
            .setColor(0xffaa00)
            .setTitle('⚠️ 警告（未封鎖）')
            .setDescription(`**${member.user.tag}** 已被禁言 10 分鐘，再次觸犯將被封鎖`)
            .addFields({ name: '原因', value: reason, inline: true })
            .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

// ============ V0.3.1 高置信度漸進處置 ============
// 設計原則：單一規則可能誤判（例如訊息一次 @ 3 個人是正常協作），
// 多種獨立異常在短時間內連續觸發才是高置信度訊號。
// 因此不再「單一規則直接 Ban」，改為：警告 → 禁言 → 封鎖 的漸進式處置。

// 跨類型異常累積：10 分鐘內該使用者觸發的所有自動規則總數
function countStrikes(userId, guildId) {
    const now = Date.now();
    let total = 0;
    const suffix = `_${userId}_${guildId}`;
    for (const [key, d] of trackers) {
        if (key.startsWith('strike_') && key.endsWith(suffix) && d && now - (d.last || 0) <= 600000) {
            total += d.count;
        }
    }
    return total;
}

// 漸進式處置：
//   一般訊號：第 1 次警告（禁言 10 分鐘）→ 10 分鐘內第 2 次禁言 1 小時 → 第 3 次封鎖
//   強訊號（opts.strong）：明確惡意（詐騙連結/XSS/惡意檔案/撞庫），維持 2 次封鎖
// 回傳 'warn' | 'timeout' | 'ban'
async function escalatePunishment(member, channel, kind, reason, opts = {}) {
    const uid = member.id, gid = member.guild.id;
    if (opts.strong) {
        const strikes = addStrike(uid, gid, kind);
        if (strikes >= 2) return await banUser(member, `🐙 ${reason}（累犯 ${strikes} 次）`, kind, channel);
        return await warnUser(member, channel, reason, kind);
    }
    addStrike(uid, gid, kind);
    const total = countStrikes(uid, gid);
    if (total >= 3) {
        return await banUser(member, `🐙 ${reason}（多次異常 ${total} 次）`, kind, channel);
    }
    if (total >= 2) {
        try { await member.timeout(3600000, `🐙 再次異常 - ${kind}`); } catch (_) {}
        logAction('TIMEOUT', {
            userId: uid,
            userTag: member.user.tag,
            guildId: gid,
            guildName: member.guild.name,
            reason: `${kind} - ${reason}`
        });
        console.log(`⏳ 禁言 1 小時 ${member.user.tag}: ${kind}`);
        if (channel) {
            try {
                const embed = new EmbedBuilder()
                    .setColor(0xff8800)
                    .setTitle('⏳ 再次異常（未封鎖）')
                    .setDescription(`**${member.user.tag}** 已被禁言 1 小時，再犯將被封鎖`)
                    .addFields({ name: '原因', value: reason, inline: true })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            } catch (_) {}
        }
        return 'timeout';
    }
    return await warnUser(member, channel, reason, kind);
}

// ============ V0.3.2 全域黑名單管理員同意制 ============
// 設計原因：全域黑名單跨伺服器永久生效、僅開發者可解除——若開發者失聯將無人能解。
// 因此抓人不再自動加入全域，改為：本伺服器封鎖 → 警報頻道發提名 → 管理員同意才加入全域。

function canApproveGlobalBan(interaction) {
    if (!interaction || !interaction.member) return false;
    if (interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return isWhitelisted(interaction.member);
}

async function proposeGlobalBan(member, reason, channel = null) {
    try {
        const gid = member.guild.id, uid = member.id;
        // 24 小時內同一伺服器不重複提名同一使用者
        const k = `gb_${gid}_${uid}`;
        const now = Date.now();
        if (trackers.has(k) && now - trackers.get(k).last < 86400000) return false;
        trackers.set(k, { last: now });
        const guild = member.guild;
        const cid = config.alertChannel[gid];
        const target = cid ? guild.channels.cache.get(cid) : guild.systemChannel;
        if (!target) return false;
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🌐 全域黑名單提名')
            .setDescription(`**${member.user.tag}**（\`${uid}\`）已被本伺服器封鎖\n管理員確認後將加入**全域黑名單**（所有伺服器永久封鎖，僅開發者可解除）`)
            .addFields(
                { name: '原因', value: reason || '未知', inline: false },
                { name: '伺服器', value: guild.name, inline: true },
                { name: '時效', value: '24 小時內有效', inline: true }
            )
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`gb_${gid}_${uid}_approve`).setLabel('✅ 同意加入全域').setStyle(3),
            new ButtonBuilder().setCustomId(`gb_${gid}_${uid}_reject`).setLabel('❌ 拒絕').setStyle(4)
        );
        const msg = await target.send({ embeds: [embed], components: [row] });
        const collector = msg.createMessageComponentCollector({ time: 86400000 });
        collector.on('collect', async (i) => {
            if (!canApproveGlobalBan(i)) {
                await i.reply({ content: '❌ 僅限管理員或白名單成員決定', ephemeral: true }).catch(() => {});
                return;
            }
            const approve = i.customId.endsWith('_approve');
            await msg.edit({ components: [] }).catch(() => {});
            if (approve) {
                const added = addToBlacklist(uid, { reason: `管理員同意全域封鎖：${reason || '未知'}`, guildId: gid, guildName: guild.name });
                await i.reply({ content: added ? `✅ **${member.user.tag}** 已加入全域黑名單` : 'ℹ️ 已在全域黑名單中', ephemeral: true }).catch(() => {});
                logAction('GLOBAL_BAN', { userId: uid, userTag: member.user.tag, guildId: gid, guildName: guild.name, reason: `管理員同意：${reason}` });
                console.log(`🌐 全域黑名單 + ${member.user.tag}`);
                scanAll();
            } else {
                await i.reply({ content: '✅ 已拒絕，僅本伺服器封鎖', ephemeral: true }).catch(() => {});
                logAction('GLOBAL_BAN_DENIED', { userId: uid, userTag: member.user.tag, guildId: gid, guildName: guild.name, reason });
                console.log(`🚫 拒絕全域提名: ${member.user.tag}`);
            }
        });
        collector.on('end', () => { msg.edit({ components: [] }).catch(() => {}); });
        return true;
    } catch (e) {
        console.error(`全域提名失敗: ${e.message}`);
        return false;
    }
}

// ============ V0.3.2 輸入層消毒 ============
// 剝離零寬/隱形字元（ZWSP/ZWJ/BOM/軟連字號/雙向控制）——攻擊者常插入隱形字元繞過關鍵字偵測
function sanitizeContent(str) {
    return String(str || '').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u200E\u200F\u202A-\u202E]/g, '');
}

// ============ 間隔檢測 ============
const trackers = new Map();

function checkInterval(trackerKey, maxInterval, timeWindow) {
    const now = Date.now();
    if (!trackers.has(trackerKey)) {
        trackers.set(trackerKey, { times: [], last: now });
        return false;
    }
    const data = trackers.get(trackerKey);
    data.times = data.times.filter(t => now - t < timeWindow);
    data.times.push(now);
    data.last = now;
    if (data.times.length >= 3) {
        const intervals = [];
        for (let i = 1; i < data.times.length; i++) {
            intervals.push(data.times[i] - data.times[i - 1]);
        }
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avg < maxInterval) {
            return { triggered: true, avg: Math.round(avg), count: data.times.length, reason: `平均 ${Math.round(avg)}ms < ${maxInterval}ms` };
        }
    }
    return false;
}

// V0.2.3 記憶體洩漏修復：原本只清理「有 times 陣列」的間隔型追蹤器，
// 而 addStrike（strike_*）、checkBruteForce（brute_*）、trackBehavior（behavior_*）、
// checkRateLimit（rl_*）產生的條目永遠不會被刪除，長時間運作會導致記憶體無限增長。
// 現在依各類型的過期語義逐型清理。
function cleanupTrackers() {
    const now = Date.now();
    for (const [key, data] of trackers) {
        if (!data || typeof data !== 'object') { trackers.delete(key); continue; }
        // 間隔型（checkInterval）：有 times 陣列，逾 60 秒無活動即刪除
        if (Array.isArray(data.times)) {
            data.times = data.times.filter(t => now - t < 60000);
            if (data.times.length === 0 && (data.last || 0) + 60000 < now) {
                trackers.delete(key);
            }
            continue;
        }
        // 累犯計數（addStrike）：{count, last}，逾 10 分鐘無觸發即刪除（與 10 分鐘累犯窗口一致）
        if (key.startsWith('strike_')) {
            if (now - (data.last || 0) > 600000) trackers.delete(key);
            continue;
        }
        // 面板冷卻（checkBruteForce）：{attempts, blocked, until}
        if (key.startsWith('brute_')) {
            if (data.blocked) {
                if (now >= (data.until || 0)) trackers.delete(key);
            } else {
                data.attempts = (data.attempts || []).filter(t => now - t < 60000);
                if (data.attempts.length === 0) trackers.delete(key);
            }
            continue;
        }
        // @everyone/@here 濫用（trackMention）：{times, last}，逾 60 秒無活動即刪除
        if (key.startsWith('mention_')) {
            data.times = (data.times || []).filter(t => now - t < 60000);
            if (data.times.length === 0 && (data.last || 0) + 60000 < now) trackers.delete(key);
            continue;
        }
        // 行為追蹤（trackBehavior）：{actions, last}
        if (key.startsWith('behavior_')) {
            data.actions = (data.actions || []).filter(t => now - t < 60000);
            if (data.actions.length === 0 && now - (data.last || 0) > 60000) trackers.delete(key);
            continue;
        }
        // RateLimit（checkRateLimit）：{count, reset}
        if (key.startsWith('rl_')) {
            if (now >= (data.reset || 0)) trackers.delete(key);
            continue;
        }
        // 面板限流（checkCmdRate）：{t}，逾 10 秒即刪除
        if (key.startsWith('cmd_')) {
            if (now - (data.t || 0) > 10000) trackers.delete(key);
            continue;
        }
        // 重複內容（checkDuplicate）：{msgs:[{t,h}], last}，逾 60 秒無活動刪除
        if (key.startsWith('dup_')) {
            data.msgs = (data.msgs || []).filter(m => now - (m && m.t) < 30000);
            if (data.msgs.length === 0 && now - (data.last || 0) > 60000) trackers.delete(key);
            continue;
        }
        // 未知型態保險：超過 10 分鐘無更新即刪除
        if (now - (data.last || 0) > 600000) trackers.delete(key);
    }
}

// ============ 檢測函數 ============
const DETECT = {
    stopLoss: (u, g) => checkInterval(`stop_${u}_${g}`, 500, 2000),
    mentionSpeed: (u, g) => checkInterval(`mention_${u}_${g}`, 300, 3000),
    script: (u, g) => checkInterval(`script_${u}_${g}`, 800, 5000),
    selfbot: (u, g) => checkInterval(`self_${u}_${g}`, 400, 5000),
    flood: (u, g) => checkInterval(`flood_${u}_${g}`, 200, 3000),
    crawler: (u, g) => checkInterval(`crawler_${u}_${g}`, 150, 3000),
    voice: (u, g) => checkInterval(`voice_${u}_${g}`, 800, 10000),
    permSpam: (g, c) => checkInterval(`perm_${g}_${c}`, 300, 2000),
    channelSpam: (g, t) => checkInterval(`ch_${g}_${t}`, 500, 10000),
    collusion: (u, g) => checkInterval(`coll_${u}_${g}`, 1000, 30000),
    invite: (u, g) => checkInterval(`invite_${u}_${g}`, 2000, 60000),
    webhook: (w, g) => checkInterval(`web_${w}_${g}`, 800, 5000),
    join: (g) => checkInterval(`join_${g}`, 1000, 30000)
};

// ============ 其他輔助 ============
function isSuspicious(user) {
    const age = (Date.now() - user.createdTimestamp) / 86400000;
    if (age < 7) return { suspicious: true, reason: `帳號 < 7 天 (${Math.round(age)}天)` };
    if (age < 30 && !user.avatar) return { suspicious: true, reason: `< 30天無頭像` };
    return { suspicious: false };
}

// ============ V0.2.5 詐騙連結攔截 ============
// 力大磚飛：內建常見詐騙/釣魚域名黑名單 + 偽官方域名偵測 + IP 直連偵測
const SCAM_DOMAINS = [
    'discord-nitro', 'discordnitro', 'discordgift', 'discord.gift', 'free-nitro',
    'nitro-gift', 'nitrogift', 'nitro-free', 'nitro-giveaway', 'discord-airdrop',
    'discord-free', 'discord-verify', 'discord-verification', 'discord-mod',
    'discord-staff', 'discord-support', 'discord-safety', 'steam-gift', 'steamgift',
    'steam-codes', 'steamcodes', 'steam-free', 'netflix-gift', 'netflixgift',
    'giveaway-nitro', 'free-gift'
];
const OFFICIAL_DOMAINS = [
    'discord.com', 'discord.gg', 'discordapp.com', 'discord.js.org', 'discordjs.guide',
    'discordpy.readthedocs.io', 'steampowered.com', 'steamcommunity.com', 'github.com',
    'github.io', 'gitlab.com', 'youtube.com', 'youtu.be', 'twitch.tv', 'twitter.com',
    'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'medium.com',
    'notion.so', 'google.com', 'docs.google.com', 'drive.google.com', 'microsoft.com',
    'apple.com', 'spotify.com', 'netflix.com', 'amazon.com', 'paypal.com', 'wikipedia.org',
    'stackoverflow.com', 'stackexchange.com', 'npmjs.com', 'nodejs.org', 'python.org',
    'mozilla.org', 'cloudflare.com', 'vercel.com', 'netlify.com', 'replit.com', 'glitch.com',
    'codepen.io', 'jsfiddle.net', 'play.google.com', 'apps.apple.com', 'roblox.com',
    'minecraft.net', 'epicgames.com', 'xbox.com', 'playstation.com', 'nintendo.com'
];

const SHORTENER_DOMAINS = [
    'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'is.gd', 'cutt.ly', 'rb.gy', 's.id',
    'shorturl.at', 'tiny.cc', 'ow.ly', 'buff.ly', 'rebrand.ly', 'short.link', 'ur0.link', 'u.nu'
];

// V0.2.9：網址混淆還原——還原 hxxp://、[.]、(.)、{ . }、全形點、空格、零寬字元等繞過手法
function normalizeLink(url) {
    let u = (url || '')
        .replace(/[\[\{\(]\s*\.\s*[\]\}\)]/g, '.')
        .replace(/[．。]/g, '.')
        .replace(/\s+/g, '')
        .replace(/[\u200b\u200c\u200d\ufeff]/g, '');
    u = u.replace(/^hxxps?:\/\//i, (m) => (/^hxxps/i.test(m) ? 'https://' : 'http://'));
    return u;
}

// V0.2.9：抓取使用混淆手法的可疑網址（hxxp 前綴、[.]、(.)、全形點、空格分隔＋釣魚關鍵字）
function extractObfuscatedUrls(content) {
    const out = [];
    const c = (content || '');
    // hxxp/hXXp 混淆協議
    out.push(...(c.match(/hxxps?:\/\/[^\s<>"']+/gi) || []));
    // 明確混淆點符號：[.]、(.)、{ . }、．、。
    out.push(...(c.match(/[\w-]+(?:\s*[\[\{\(]\s*\.\s*[\]\}\)]\s*|\s*[．。]\s*)[\w.-]+/gi) || []));
    // 空格分隔混淆（discord . com）：僅在含釣魚關鍵字時抓取，避免誤判正常文字
    out.push(...(c.match(/[\w-]+(?:\s+\.\s+)+[\w.-]+/gi) || []).filter(x => /(discord|steam|nitro|gift|verify|airdrop|free)/i.test(x)));
    // 去重：以主機名為鍵（帶協議與不帶協議視為同一網址，保留先捕獲的完整版）
    const seen = new Set();
    const res = [];
    for (const u of out) {
        const nu = normalizeLink(u);
        const key = nu.replace(/^https?:\/\//i, '');
        if (seen.has(key)) continue;
        seen.add(key);
        res.push(nu);
    }
    return res;
}

// V0.2.9：短網址服務判定（無法確認真實目標，僅記錄與警示）
function isShortener(host) {
    return SHORTENER_DOMAINS.includes(host);
}

// V0.3.0：大量加入防護——60 秒內 ≥5 個新成員加入即回傳數量（防 raid 警示）
function trackJoin(gid) {
    const now = Date.now();
    const k = `join_${gid}`;
    const d = trackers.get(k) || { times: [], last: now };
    d.times = d.times.filter(t => now - t < 60000);
    d.times.push(now);
    d.last = now;
    trackers.set(k, d);
    return d.times.length >= 5 ? d.times.length : 0;
}

// V0.3.0：純文字釣魚偵測——無連結的贈禮/驗證詐騙話術（僅警示，不刪除不處罰）
function detectTextScam(content) {
    const c = (content || '').toLowerCase();
    const patterns = [
        [/(?:free|claim|get|win)[\s-]+(?:discord\s+)?nitro/i, '免費 Nitro 話術'],
        [/discord[\s-]+(?:nitro[\s-]+)?gift/i, 'Discord 贈禮話術'],
        [/(?:steam|discord)[\s-]+gift[\s-]+(?:code|card)/i, '贈禮碼話術'],
        [/verify[\s-]+(?:your|the)[\s-]+(?:account|server|discord)/i, '驗證帳號釣魚話術'],
        [/\b(?:discordnitro|nitro\s+gift|free\s+nitro)\b/i, 'Nitro 關鍵字話術']
    ];
    for (const [p, reason] of patterns) {
        if (p.test(c)) return reason;
    }
    return null;
}

// V0.3.3：進階注入偵測——SQL 注入/命令注入/惡意模板（僅警示，不刪除不處罰）
// 只命中「明確惡意組合」，一般教學內容（SELECT * FROM users、${name} 模板字串）不會誤判
function detectInjection(content) {
    const c = String(content || '');
    if (c.length > 4000) return null; // 超長訊息交給資源耗盡防禦處理
    const patterns = [
        [/(?:'|")\s*(?:or|and)\s+(?:'|")?\d+(?:'|")?\s*=\s*(?:'|")?\d+/i, 'SQL 注入（恆真條件）'],
        [/\bunion\s+select\s+(?:null|\d+|\w+)(?:\s*,\s*(?:null|\d+|\w+)){0,9}/i, 'SQL 注入（UNION SELECT）'],
        [/;\s*(?:drop|delete|truncate|update|insert)\s+(?:table|from|into)/i, 'SQL 注入（破壞性語句）'],
        [/\b(?:or|and)\b[^;\n]{0,40}=[^;\n]{0,40}--/i, 'SQL 注入（注釋繞過）'],
        [/;\s*(?:rm|sh|bash|wget|curl|nc|ncat|python3?|powershell|cmd|perl)\s/i, '命令注入（分號鏈接）'],
        [/\|\s*(?:sh|bash|nc|ncat|python3?)\s/i, '命令注入（管道執行）'],
        [/\$\s*\(\s*[a-z_][a-z0-9_]*\s/i, '命令注入（$() 執行）'],
        [/\x60[^\x60\n]{2,}\x60/, '命令注入（反引號執行）'],
        [/\$\{\s*(?:require|process|global|eval|Function|child_process|exec)\b/i, 'JS 注入（惡意模板）'],
        [/\{\{\s*(?:config|settings|env|this\.|process)\b/i, '模板注入']
    ];
    for (const [p, reason] of patterns) {
        if (p.test(c)) return reason;
    }
    return null;
}

// V0.2.9：Webhook 名稱假冒偵測（名稱仿冒 discord/steam/nitro 官方或贈禮）
function isHookImpersonating(name) {
    const n = (name || '').toLowerCase();
    return /(discord|steam|nitro)[\s_-]*(nitro|gift|giveaway|free|airdrop|mod|staff|admin|system|verify|verification|support)/.test(n) ||
        /(nitro|gift)[\s_-]*(free|giveaway|code)/.test(n);
}

// V0.2.9：面板指令限流（每使用者 5 秒 1 次，防濫發）
function checkCmdRate(uid) {
    const now = Date.now();
    const k = `cmd_${uid}`;
    const last = trackers.get(k);
    if (last && now - (last.t || 0) < 5000) return false;
    trackers.set(k, { t: now });
    return true;
}

function extractUrls(content) {
    const re = /https?:\/\/[^\s<>"']+/gi;
    return (content.match(re) || []).map(u => u.replace(/[),.;!?]+$/, ''));
}

function getScamReason(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'IP 直連連結';
        // V0.2.9：短網址服務——無法確認真實目標，標記風險
        if (isShortener(host)) return `短網址服務 (${host})`;
        const isOfficial = OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o));
        if (isOfficial) return null;
        // V0.2.6：管理員自訂詐騙域名（blacklist.scamDomains）；loadBlacklist 失敗時略過此檢查
        try {
            const customScam = (loadBlacklist().scamDomains || []);
            for (const d of customScam) {
                if (host === d || host.endsWith('.' + d)) return `自訂詐騙域名 (${host})`;
            }
        } catch (_) {}
        for (const s of SCAM_DOMAINS) {
            if (host.includes(s)) return `詐騙域名 (${host})`;
        }
        if (/(discord|steam|nitro)/.test(host)) return `疑似偽裝官方連結 (${host})`;
        return null;
    } catch (_) { return null; }
}

// ============ V0.2.5 重複內容偵測 ============
// 同一使用者 30 秒內發送 ≥5 條內容相同（前 100 字元）的訊息即觸發
function checkDuplicate(userId, guildId, content) {
    const key = `dup_${userId}_${guildId}`;
    const now = Date.now();
    const hash = (content || '').slice(0, 100);
    if (!trackers.has(key)) trackers.set(key, { msgs: [], last: now });
    const d = trackers.get(key);
    d.msgs = d.msgs.filter(m => now - m.t < 30000);
    d.msgs.push({ t: now, h: hash });
    d.last = now;
    const same = d.msgs.filter(m => m.h === hash).length;
    return same >= 5 ? { triggered: true, count: same } : false;
}

// ============ V0.2.5 假冒名稱偵測 ============
// 名稱含 discord/steam/nitro + 贈禮/官方關鍵字組合時回傳原因字串，否則 null
function isImpersonating(user) {
    const name = ((user && (user.username || user.globalName)) || '').toLowerCase();
    const patterns = [
        [/discord\s*(nitro|gift|giveaway|free|airdrop|mod|staff|admin|support|system|verify|verification)/, '名稱含 discord+官方/贈禮關鍵字'],
        [/nitro\s*(gift|free|giveaway)/, '名稱含 nitro+贈禮關鍵字'],
        [/steam\s*(gift|free|giveaway|codes?)/, '名稱含 steam+贈禮關鍵字'],
        [/(free|gift)\s*(nitro|steam|discord)/, '名稱含免費贈禮關鍵字']
    ];
    for (const [p, reason] of patterns) {
        if (p.test(name)) return reason;
    }
    return null;
}

// ============ V0.2.6 機器人同名假冒偵測 ============
// 發現名稱含 OctopCutes 的其他機器人時記錄警報（不自動處理，避免誤判）
async function checkImposterBots() {
    let found = 0;
    for (const [, guild] of client.guilds.cache) {
        try {
            const members = await guild.members.fetch();
            for (const [, m] of members) {
                if (m.user.bot && m.user.id !== client.user.id && m.user.username.toLowerCase().includes('octopcutes')) {
                    found++;
                    console.warn(`🚨 疑似假冒機器人: ${m.user.tag} (ID ${m.user.id}) @ ${guild.name}`);
                    logAction('IMPOSTER_BOT', { botId: m.user.id, botTag: m.user.tag, guildId: guild.id, guildName: guild.name });
                }
            }
        } catch (_) {}
    }
    if (found > 0) console.warn(`🚨 共發現 ${found} 個疑似假冒機器人`);
    return found;
}

// ============ V0.2.7 詐騙域名自主學習（輕量規則式，無需 ML） ============
// 1) 偽官方域名（discord/steam/nitro 但非官方）被不同訊息命中 ≥3 次 → 自動提升為明確詐騙域名
// 2) 自訂域名加入超過 14 天仍零命中 → 低置信，自動移除
// V0.2.8：詐騙學習候選池——持久化至 blacklist.json，每日隨機重啟不再遺失學習進度
// 結構：{ host: { count, firstHit, lastHit } }；count ≥3 且非官方 → 提升為明確詐騙域名
function getScamCandidates() {
    const bl = loadBlacklist();
    if (!bl.scamCandidateStats || typeof bl.scamCandidateStats !== 'object') bl.scamCandidateStats = {};
    return bl.scamCandidateStats;
}
// 命中「疑似偽裝官方」時累計候選計數並立即寫入黑名單檔（輕量持久化）
function recordScamCandidate(host) {
    const cand = getScamCandidates();
    const st = cand[host] = cand[host] || { count: 0, firstHit: Date.now(), lastHit: Date.now() };
    st.count++;
    st.lastHit = Date.now();
    saveBlacklist(loadBlacklist());
}
// 域名格式驗證（防駭）：避免學習/新增注入怪異字串污染清單
function isValidDomain(host) {
    if (typeof host !== 'string') return false;
    const h = host.trim().toLowerCase();
    if (!h || h.length > 253) return false;
    if (!/^(?=.*\.)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(h)) return false;
    if (h.includes('..')) return false;
    return true;
}
// 清除超過 72 小時未命中的過期候選（記憶體高水位時呼叫）
function pruneScamCandidates() {
    const cand = getScamCandidates();
    const now = Date.now();
    let n = 0;
    for (const [h, st] of Object.entries(cand)) {
        if (now - (st.lastHit || st.firstHit || 0) > 72 * 60 * 60 * 1000) { delete cand[h]; n++; }
    }
    if (n > 0) saveBlacklist(loadBlacklist());
    return n;
}
function learnScamDomains() {
    const bl = loadBlacklist();
    bl.scamDomains = bl.scamDomains || [];
    bl.scamDomainMeta = bl.scamDomainMeta || {};
    const candidates = getScamCandidates();
    const now = Date.now();
    let learned = 0, removed = 0, forgotten = 0;
    // 1) 自動提升：候選命中 ≥3 次且非官方 → 提升為明確詐騙域名（學習後移除候選）
    for (const [host, st] of Object.entries(candidates)) {
        if (st.count >= 3 && !bl.scamDomains.includes(host) && !OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o))) {
            bl.scamDomains.push(host);
            bl.scamDomainMeta[host] = { reports: st.count, hits: 0, addedAt: now, source: '自主學習', learnedAt: now };
            logAction('SCAM_LEARN', { domain: host, reports: st.count });
            console.log(`🧠 自主學習: ${host} 被命中 ${st.count} 次，已加入詐騙域名`);
            learned++;
            delete candidates[host];
            continue;
        }
        // V0.2.8：候選老化——超過 72 小時未再命中即清除（防誤判與無界累積）
        if (now - (st.lastHit || st.firstHit || 0) > 72 * 60 * 60 * 1000) {
            delete candidates[host];
            forgotten++;
        }
    }
    // 2) 低置信移除
    for (const d of [...bl.scamDomains]) {
        const meta = bl.scamDomainMeta[d];
        if (meta && meta.addedAt && now - meta.addedAt > 14 * 24 * 60 * 60 * 1000 && !(meta.hits > 0)) {
            bl.scamDomains = bl.scamDomains.filter(x => x !== d);
            delete bl.scamDomainMeta[d];
            logAction('SCAM_FORGET', { domain: d });
            console.log(`🧠 自主學習: ${d} 14 天零命中，已移除（低置信）`);
            removed++;
        }
    }
    if (learned || removed || forgotten) saveBlacklist(bl);
    console.log(`🧠 學習回合完成: 新增 ${learned}、移除 ${removed}、老化清除 ${forgotten}`);
    return { learned, removed, forgotten };
}
// 每 24 小時執行一次學習回合
setInterval(() => { try { learnScamDomains(); } catch (e) { console.error('學習失敗:', e.message); } }, 24 * 60 * 60 * 1000);

function checkBruteForce(userId) {
    const key = `brute_${userId}`;
    const now = Date.now();
    if (!trackers.has(key)) trackers.set(key, { attempts: [], blocked: false, until: 0 });
    const d = trackers.get(key);
    if (d.blocked && now < d.until) return { allowed: false, reason: `封鎖中，剩餘 ${Math.round((d.until - now) / 1000)}秒` };
    d.attempts = d.attempts.filter(t => now - t < 60000);
    d.attempts.push(now);
    if (d.attempts.length > 5) {
        d.blocked = true;
        d.until = now + 300000;
        console.log(`🔒 暫時封鎖: ${userId}`);
        return { allowed: false, reason: '嘗試過多，封鎖5分鐘' };
    }
    return { allowed: true };
}

function trackBehavior(userId) {
    const key = `behavior_${userId}`;
    const now = Date.now();
    if (!trackers.has(key)) trackers.set(key, { actions: [], last: now });
    const d = trackers.get(key);
    d.actions = d.actions.filter(t => now - t < 60000);
    d.actions.push(now);
    d.last = now;
    if (d.actions.length > 20) {
        console.log(`⚠️ 異常行為: ${userId} (${d.actions.length}次/分鐘)`);
        return true;
    }
    return false;
}

// V0.2.6：@everyone/@here 濫用追蹤——60 秒內 ≥3 次觸發
function trackMention(userId) {
    const key = `mention_${userId}`;
    const now = Date.now();
    if (!trackers.has(key)) trackers.set(key, { times: [], last: now });
    const d = trackers.get(key);
    d.times = d.times.filter(t => now - t < 60000);
    d.times.push(now);
    d.last = now;
    return d.times.length >= 3 ? { triggered: true, count: d.times.length } : false;
}

function checkRateLimit(userId) {
    const key = `rl_${userId}`;
    const now = Date.now();
    if (!trackers.has(key)) trackers.set(key, { count: 0, reset: now + 60000 });
    const d = trackers.get(key);
    if (now > d.reset) { d.count = 0; d.reset = now + 60000; }
    d.count++;
    return d.count <= 30;
}

let sysStatus = { mode: 'normal', lastCheck: Date.now(), errors: 0, requests: 0 };

function checkSystem() {
    const now = Date.now();
    if (now - sysStatus.lastCheck < 60000) return sysStatus.mode;
    sysStatus.lastCheck = now;
    if (sysStatus.errors > 50) sysStatus.mode = 'emergency';
    else if (sysStatus.requests > 500) sysStatus.mode = 'degraded';
    else sysStatus.mode = 'normal';
    sysStatus.errors = 0;
    sysStatus.requests = 0;
    return sysStatus.mode;
}

// ============ 機器人啟動 ============
client.once(Events.ClientReady, async (ready) => {
    console.log(`✅ 登入為 ${ready.user.tag}`);
    console.log(`📋 黑名單: ${loadBlacklist().bannedUsers.length} 人`);
    console.log(`👑 開發者: ${DEVELOPER_ID}`);
    loadConfig();
    console.log(`👑 白名單: ${config.whitelist.users.length} 人, ${config.whitelist.roles.length} 角色`);
    console.log(`🛡️ 安全設定: ${Object.keys(config.security).length} 伺服器`);
    console.log(`📡 輸入 !章魚`);
    await scanAll();
});

let scanning = false;
async function scanAll() {
    // V0.2.4：防止掃描尚未結束就再次觸發（30 分鐘定時與啟動掃描重疊時）
    if (scanning) return;
    scanning = true;
    try {
        const blacklist = loadBlacklist();
        if (blacklist.bannedUsers.length === 0) { console.log('📋 黑名單為空'); return; }
        console.log(`🔍 掃描 ${client.guilds.cache.size} 個伺服器...`);
        let total = 0;
        for (const [, guild] of client.guilds.cache) {
            if (getSecurity(guild.id).honorGlobalBlacklist === false) {
                console.log(`⏭️ ${guild.name} 已選擇不套用全域黑名單，略過`);
                continue;
            }
            try {
                const members = await guild.members.fetch();
                for (const userId of blacklist.bannedUsers) {
                    const m = members.get(userId);
                    if (m && !m.user.bot) {
                        if (await banUser(m, '🐙 全域黑名單', '全域掃描', null, false)) total++;
                    }
                }
            } catch (e) { console.log(`⚠️ ${guild.name}: ${e.message}`); }
        }
        console.log(`✅ 共封鎖 ${total} 人`);
    } finally {
        scanning = false;
    }
}

// ============ 主面板 ============
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    // V0.2.7：指令收斂——所有操作統一由面板 UI 完成，!章魚 僅作為入口
    if (msg.content.trim() !== '!章魚') {
        if (msg.content.trim().startsWith('!章魚 ')) return msg.reply('💡 所有操作已整合到控制面板，請直接輸入 `!章魚` 開啟');
        return;
    }
    if (!msg.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return msg.reply('❌ 需要管理員權限！');
    }
    if (getSecurity(msg.guildId).bruteForce !== false) {
        const bf = checkBruteForce(msg.author.id);
        if (!bf.allowed) return msg.reply(`⚠️ ${bf.reason}`);
    }
    // V0.2.9：面板指令限流（每使用者 5 秒 1 次）
    if (!checkCmdRate(msg.author.id)) return msg.reply('⏳ 操作太頻繁，請 5 秒後再試');
    await showPanel(msg);
});

async function showPanel(msg) {
    const gid = msg.guildId;
    const guild = msg.guild;
    const bl = loadBlacklist();
    const isDev = msg.author.id === DEVELOPER_ID;
    const sec = getSecurity(gid);
    const alert = getAlert(gid);

    // ===== 自動清理過時訊息 =====
    try {
        const fetched = await msg.channel.messages.fetch({ limit: 20 });
        const botMessages = fetched.filter(m => m.author.id === client.user.id);
        if (botMessages.size > 1) {
            // 保留最新的一則，刪除其他
            const sorted = botMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
            const toDelete = sorted.slice(1);
            for (const m of toDelete) {
                await m.delete().catch(() => {});
            }
            console.log(`🧹 清理了 ${toDelete.size} 則過時訊息`);
        }
    } catch (e) {
        // 忽略清理錯誤
    }

    const secCount = Object.values(sec).filter(v => v).length;
    const alertCount = Object.values(alert).filter(v => v).length;

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('sec').setLabel('🛡️ 安全設定').setStyle(3),
            new ButtonBuilder().setCustomId('alert').setLabel('🔔 警報設定').setStyle(2),
            new ButtonBuilder().setCustomId('refresh').setLabel('🔄 刷新').setStyle(2),
            new ButtonBuilder().setCustomId('scam').setLabel('🌐 詐騙域名').setStyle(1)
        );

    const row2 = new ActionRowBuilder();
    if (isDev) {
        row2.addComponents(
            new ButtonBuilder().setCustomId('bl').setLabel('📋 黑名單').setStyle(4),
            new ButtonBuilder().setCustomId('wl').setLabel('👑 白名單').setStyle(3),
            new ButtonBuilder().setCustomId('auto').setLabel('💬 自動回應').setStyle(1),
            new ButtonBuilder().setCustomId('export').setLabel('📤 匯出').setStyle(3),
            new ButtonBuilder().setCustomId('stop').setLabel('🛑 緊急停機').setStyle(4)
        );
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🐙 章魚防護系統')
        .setDescription('自動安全防護與管理面板')
        .addFields(
            { name: '📋 黑名單', value: `${bl.bannedUsers.length} 人`, inline: true },
            { name: '👑 白名單', value: `${config.whitelist.users.length + config.whitelist.roles.length} 個`, inline: true },
            { name: '🛡️ 安全', value: `${secCount}/${Object.keys(sec).length} 啟用`, inline: true },
            { name: '🔔 警報', value: `${alertCount}/${Object.keys(alert).length} 啟用`, inline: true }
        )
        .setFooter({ text: `管理員 • ${guild.name}` })
        .setTimestamp();

    const components = [row1];
    if (row2.components.length > 0) components.push(row2);

    await msg.reply({ embeds: [embed], components: components });
}

// ============ 安全設定面板 ============
// 原版把 22 個開關硬塞進最多 5 列元件的訊息裡，slice(0,20) 導致最後兩項
// (roleLock、channelSpam) 永遠沒有按鈕、管理員完全無法切換。這裡改為分頁，
// 確保每一個安全選項都能被實際操作到。
const SECURITY_FEATURES = [
    ['stopLoss', '止損'], ['mentionSpeed', '@mention'], ['scriptDetection', '腳本'],
    ['voiceAbuse', '語音'], ['webhookMonitor', 'Webhook'], ['selfbotDetection', 'SelfBot'],
    ['floodProtection', '洪水'], ['floodJoin', '洪水加入'], ['permissionSpam', '權限變更'],
    ['maliciousFile', '惡意檔案'], ['xssProtection', 'XSS'], ['richPresence', 'RichP'],
    ['crawlerDetection', '爬蟲'], ['collusionAttack', '撞庫'], ['suspiciousAccount', '可疑帳號'],
    ['bruteForce', '面板冷卻'], ['rateLimit', 'RateLimit'], ['autoDegrade', '降級'],
    ['inviteMonitor', '邀請'], ['roleLock', '角色鎖定'], ['channelSpam', '頻道監控'],
    // V0.2.5 新增
    ['scamLink', '詐騙連結'], ['duplicateSpam', '重複內容'], ['impersonation', '假冒名稱'],
    // V0.2.6 新增
    ['mentionSpam', '@everyone']
];
const SEC_PAGE_SIZE = 10;

async function showSecurityPanel(i, page = 0) {
    const gid = i.guildId;
    const sec = getSecurity(gid);
    const totalPages = Math.ceil(SECURITY_FEATURES.length / SEC_PAGE_SIZE);
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageFeatures = SECURITY_FEATURES.slice(page * SEC_PAGE_SIZE, page * SEC_PAGE_SIZE + SEC_PAGE_SIZE);

    const rows = [];
    let row = new ActionRowBuilder();
    let count = 0;
    for (const [k, name] of pageFeatures) {
        const status = sec[k] !== undefined ? sec[k] : true;
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`sec_${k}`)
                .setLabel(name)
                .setStyle(status ? 3 : 4)
                .setEmoji(status ? '✅' : '❌')
        );
        count++;
        if (count === 5) { rows.push(row); row = new ActionRowBuilder(); count = 0; }
    }
    if (count > 0) rows.push(row);

    const navRow = new ActionRowBuilder();
    if (page > 0) navRow.addComponents(new ButtonBuilder().setCustomId(`secpage_${page - 1}`).setLabel('⬅️ 上一頁').setStyle(2));
    if (page < totalPages - 1) navRow.addComponents(new ButtonBuilder().setCustomId(`secpage_${page + 1}`).setLabel('➡️ 下一頁').setStyle(2));
    navRow.addComponents(new ButtonBuilder().setCustomId('back').setLabel('🔙 返回').setStyle(2));
    rows.push(navRow);

    const statusText = pageFeatures.map(([k, name]) => {
        const s = sec[k] !== undefined ? sec[k] : true;
        return `${s ? '✅' : '❌'} ${name}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🛡️ 安全設定')
        .setDescription(`點擊切換開關（第 ${page + 1}/${totalPages} 頁）`)
        .addFields({ name: '📋 狀態', value: statusText, inline: false })
        .setFooter({ text: '管理員專用' })
        .setTimestamp();

    await i.reply({ embeds: [embed], components: rows, flags: 64 });
}

// ============ 警報設定面板 ============
async function showAlertPanel(i) {
    const gid = i.guildId;
    const alert = getAlert(gid);
    const features = [
        ['suspiciousAccount', '可疑帳號'], ['floodJoin', '洪水加入'],
        ['webhookAbuse', 'Webhook'], ['permissionAbuse', '權限變更'],
        ['botBanned', '機器人被Ban'], ['channelSpam', '頻道監控'],
        ['roleAbuse', '角色權限'], ['inviteAbuse', '邀請濫用'],
        ['richPresence', 'RichP']
    ];

    const rows = [];
    let row = new ActionRowBuilder();
    let count = 0;

    for (const [k, name] of features) {
        const status = alert[k] !== undefined ? alert[k] : true;
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`alert_${k}`)
                .setLabel(name)
                .setStyle(status ? 3 : 4)
                .setEmoji(status ? '✅' : '❌')
        );
        count++;
        if (count === 5) {
            rows.push(row);
            row = new ActionRowBuilder();
            count = 0;
        }
    }
    if (count > 0) rows.push(row);

    const statusText = features.map(([k, name]) => {
        const s = alert[k] !== undefined ? alert[k] : true;
        return `${s ? '✅' : '❌'} ${name}`;
    }).join('\n');

    const ch = config.alertChannel[gid];
    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('set_alert_ch').setLabel('📢 設定頻道').setStyle(1),
            new ButtonBuilder().setCustomId('back').setLabel('🔙 返回').setStyle(2)
        );
    rows.push(controlRow);

    const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🔔 警報設定')
        .setDescription('點擊切換開關')
        .addFields(
            { name: '📋 狀態', value: statusText, inline: false },
            { name: '📢 頻道', value: ch ? `<#${ch}>` : '⚠️ 未設定', inline: false }
        )
        .setFooter({ text: '管理員專用' })
        .setTimestamp();

    await i.reply({ embeds: [embed], components: rows, flags: 64 });
}

// ============ 管理面板 ============
async function showManagePanel(i, type) {
    if (i.user.id !== DEVELOPER_ID) {
        return i.reply({ content: '❌ 僅開發者', flags: 64 });
    }
    const isBL = type === 'bl';
    const list = isBL ? loadBlacklist().bannedUsers : config.whitelist.users;
    const roles = isBL ? [] : config.whitelist.roles;

    let field = list.length ? list.slice(0, 20).map(id => {
        try { return `✅ <@${id}> (${id})`; } catch { return `❓ ${id}`; }
    }).join('\n') + (list.length > 20 ? `\n... 還有 ${list.length - 20} 個` : '') : '⚠️ 空';
    if (!isBL && roles.length) {
        field += '\n\n**角色**\n' + roles.map(id => {
            const r = i.guild.roles.cache.get(id);
            return r ? `✅ @${r.name} (${id})` : `❓ ${id}`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(isBL ? 0xff0000 : 0x00ff00)
        .setTitle(isBL ? '📋 黑名單' : '👑 白名單')
        .addFields({ name: '📋 列表', value: field, inline: false })
        .setFooter({ text: '輸入 ID 後按按鈕' })
        .setTimestamp();

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`${type}_add`).setLabel('➕ 新增').setStyle(3),
            new ButtonBuilder().setCustomId(`${type}_remove`).setLabel('➖ 移除').setStyle(4)
        );
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`back`).setLabel('🔙 返回').setStyle(2)
        );
    const rows = [row1, row2];
    if (!isBL) {
        const rrow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('wl_role_add').setLabel('➕ 新增角色').setStyle(1),
                new ButtonBuilder().setCustomId('wl_role_remove').setLabel('➖ 移除角色').setStyle(2)
            );
        rows.splice(1, 0, rrow);
    }

    await i.reply({ embeds: [embed], components: rows, flags: 64 });
}

// ============ 自動回應面板 ============
async function showAutoPanel(i) {
    if (i.user.id !== DEVELOPER_ID) {
        return i.reply({ content: '❌ 僅開發者', flags: 64 });
    }
    const gid = i.guildId;
    const responses = config.autoResponses[gid] || {};
    const list = Object.keys(responses).length ? 
        Object.entries(responses).map(([k, v]) => `📝 \`${k}\` → ${v.slice(0, 30)}${v.length > 30 ? '...' : ''}`).join('\n') :
        '⚠️ 無';

    const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('💬 自動回應')
        .addFields({ name: '📋 規則', value: list, inline: false })
        .setFooter({ text: '僅開發者' })
        .setTimestamp();

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('auto_add').setLabel('➕ 新增').setStyle(3),
            new ButtonBuilder().setCustomId('auto_remove').setLabel('➖ 移除').setStyle(4),
            new ButtonBuilder().setCustomId('back').setLabel('🔙 返回').setStyle(2)
        );

    await i.reply({ embeds: [embed], components: [row], flags: 64 });
}

// ============ 詐騙域名面板（V0.2.7） ============
async function showScamPanel(i) {
    const bl = loadBlacklist();
    const domains = bl.scamDomains || [];
    const meta = bl.scamDomainMeta || {};
    const field = domains.length ? domains.slice(0, 15).map(d => {
        const m = meta[d] || {};
        const tags = [];
        if (m.reports) tags.push(`回報 ${m.reports} 次`);
        if (m.hits) tags.push(`命中 ${m.hits} 次`);
        if (m.source) tags.push(m.source);
        return `🛡️ \`${d}\`${tags.length ? '（' + tags.join('・') + '）' : ''}`;
    }).join('\n') + (domains.length > 15 ? `\n... 共 ${domains.length} 個` : '') : '⚠️ 尚無自訂詐騙域名';
    const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('🌐 詐騙域名（自主學習）')
        .addFields({ name: '📋 自訂清單', value: field, inline: false })
        .setDescription('回報可疑連結後機器人會自主學習；官方網站無法被加入，14 天零命中的低置信域名會被自動移除')
        .setFooter({ text: '管理員可回報/新增/刪除' })
        .setTimestamp();
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('scam_report').setLabel('📩 回報詐騙連結').setStyle(3),
            new ButtonBuilder().setCustomId('scam_add').setLabel('➕ 新增域名').setStyle(1),
            new ButtonBuilder().setCustomId('scam_remove').setLabel('➖ 刪除域名').setStyle(4)
        );
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('back').setLabel('🔙 返回').setStyle(2)
        );
    await i.reply({ embeds: [embed], components: [row1, row2], flags: 64 });
}

// ============ 互動處理 ============
client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton()) return;
    if (!i.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return i.reply({ content: '❌ 需要管理員權限！', flags: 64 });
    }
    sysStatus.requests++;
    const gid = i.guildId;
    const uid = i.user.id;
    const isDev = uid === DEVELOPER_ID;
    const secToggle = getSecurity(gid);

    // V0.2.4：導覽類按鈕（返回/刷新/翻頁）不計入 RateLimit，避免管理員翻頁被誤鎖
    const isNav = i.customId === 'back' || i.customId === 'refresh' || i.customId.startsWith('secpage_');
    if (secToggle.rateLimit !== false && !isNav && !checkRateLimit(uid)) {
        return i.reply({ content: '⚠️ 操作過頻繁', flags: 64 });
    }
    if (secToggle.autoDegrade !== false && checkSystem() === 'emergency') {
        return i.reply({ content: '🚨 系統保護模式', flags: 64 });
    }
    if (secToggle.autoDegrade !== false && trackBehavior(uid)) {
        return i.reply({ content: '⚠️ 異常行為', flags: 64 });
    }

    try {
        switch (i.customId) {
            case 'back':
                await showPanelFromInteraction(i);
                break;
            case 'refresh':
                await showPanelFromInteraction(i);
                await i.reply({ content: '🔄 已刷新', flags: 64 });
                break;
            case 'sec':
                await showSecurityPanel(i);
                break;
            case 'alert':
                await showAlertPanel(i);
                break;
            case 'bl':
                await showManagePanel(i, 'bl');
                break;
            case 'wl':
                await showManagePanel(i, 'wl');
                break;
            case 'auto':
                await showAutoPanel(i);
                break;
            case 'scam':
                await showScamPanel(i);
                break;
            case 'stop':
                if (!isDev) return i.reply({ content: '❌ 僅開發者', flags: 64 });
                await i.reply({ content: '🛑 緊急停機中，再見！', flags: 64 });
                logAction('EMERGENCY_STOP', { userId: uid, tag: i.user.tag, source: '面板' });
                flushPendingWrites();
                setTimeout(() => { client.destroy(); process.exit(0); }, 500);
                break;
            case 'export':
                if (!isDev) return i.reply({ content: '❌ 僅開發者', flags: 64 });
                const cfg = {
                    whitelist: config.whitelist,
                    security: config.security[gid] || getDefaultSecurity(),
                    alert: config.alert[gid] || getDefaultAlert(),
                    alertChannel: config.alertChannel[gid] || null,
                    autoResponses: config.autoResponses[gid] || {}
                };
                const json = JSON.stringify(cfg, null, 2);
                await i.reply({
                    content: '📤 匯出成功',
                    files: [{ attachment: Buffer.from(json), name: `config_${gid}_${Date.now()}.json` }],
                    flags: 64
                });
                break;
            case 'set_alert_ch':
                if (!tryAcquirePrompt(uid)) return i.reply({ content: '⚠️ 已有進行中的操作，請先完成或等待超時', flags: 64 });
                try {
                await i.reply({ content: '📢 請輸入頻道 ID：', flags: 64 });
                const collected = await i.channel.awaitMessages({
                    filter: m => m.author.id === uid,
                    max: 1,
                    time: 60000
                });
                if (!collected.size) return i.followUp({ content: '⏰ 超時', flags: 64 });
                const msg = collected.first();
                if (msg.content.toLowerCase() === '取消') return i.followUp({ content: '❌ 已取消', flags: 64 });
                const cid = msg.content.trim();
                if (!/^\d{17,20}$/.test(cid)) return i.followUp({ content: '❌ 無效ID', flags: 64 });
                const ch = i.guild.channels.cache.get(cid);
                if (!ch) return i.followUp({ content: '❌ 找不到頻道', flags: 64 });
                config.alertChannel[gid] = cid;
                saveConfig();
                logAdmin(i, '設定警報頻道', `#${ch.name}`);
                await i.followUp({ content: `✅ 已設定 <#${cid}>`, flags: 64 });
                await showAlertPanel(i);
                } finally {
                    releasePrompt(uid);
                }
                break;
            default:
                // 安全設定分頁
                if (i.customId.startsWith('secpage_')) {
                    await showSecurityPanel(i, parseInt(i.customId.replace('secpage_', ''), 10) || 0);
                    break;
                }
                // 安全開關
                if (i.customId.startsWith('sec_')) {
                    const key = i.customId.replace('sec_', '');
                    const s = getSecurity(gid);
                    s[key] = !s[key];
                    saveConfig();
                    logAdmin(i, '安全切換', `${key}->${s[key] ? '啟用' : '關閉'}`);
                    await showSecurityPanel(i);
                    break;
                }
                // 警報開關
                if (i.customId.startsWith('alert_')) {
                    const key = i.customId.replace('alert_', '');
                    const a = getAlert(gid);
                    a[key] = !a[key];
                    saveConfig();
                    logAdmin(i, '警報切換', `${key}->${a[key] ? '啟用' : '關閉'}`);
                    await showAlertPanel(i);
                    break;
                }
                // 黑名單/白名單操作
                if (['bl_add', 'bl_remove', 'wl_add', 'wl_remove', 'wl_role_add', 'wl_role_remove'].includes(i.customId)) {
                    if (!isDev) return i.reply({ content: '❌ 僅開發者', flags: 64 });
                    const type = i.customId.split('_')[0];
                    const action = i.customId.includes('add') ? 'add' : 'remove';
                    const isRole = i.customId.includes('role');
                    const label = isRole ? '角色 ID' : '使用者 ID';
                    if (!tryAcquirePrompt(uid)) return i.reply({ content: '⚠️ 已有進行中的操作，請先完成或等待超時', flags: 64 });
                    try {
                    await i.reply({ content: `📝 請輸入${label}：`, flags: 64 });
                    const coll = await i.channel.awaitMessages({
                        filter: m => m.author.id === uid,
                        max: 1,
                        time: 60000
                    });
                    if (!coll.size) return i.followUp({ content: '⏰ 超時', flags: 64 });
                    const m = coll.first();
                    if (m.content.toLowerCase() === '取消') return i.followUp({ content: '❌ 已取消', flags: 64 });
                    const id = m.content.trim();
                    if (!/^\d{17,20}$/.test(id)) return i.followUp({ content: '❌ 無效ID', flags: 64 });
                    let success = false;
                    let labelText = '';
                    if (type === 'bl') {
                        if (action === 'add') success = addToBlacklist(id);
                        else success = removeFromBlacklist(id);
                        labelText = `<@${id}>`;
                    } else {
                        if (isRole) {
                            const role = i.guild.roles.cache.get(id);
                            if (!role) return i.followUp({ content: '❌ 找不到角色', flags: 64 });
                            if (action === 'add') {
                                if (!config.whitelist.roles.includes(id)) {
                                    config.whitelist.roles.push(id);
                                    saveConfig();
                                    success = true;
                                }
                            } else {
                                const idx = config.whitelist.roles.indexOf(id);
                                if (idx !== -1) { config.whitelist.roles.splice(idx, 1); saveConfig(); success = true; }
                            }
                            labelText = `@${role.name}`;
                        } else {
                            if (action === 'add') {
                                if (!config.whitelist.users.includes(id)) {
                                    config.whitelist.users.push(id);
                                    saveConfig();
                                    success = true;
                                }
                            } else {
                                const idx = config.whitelist.users.indexOf(id);
                                if (idx !== -1) { config.whitelist.users.splice(idx, 1); saveConfig(); success = true; }
                            }
                            labelText = `<@${id}>`;
                        }
                    }
                    if (success) {
                        logAdmin(i, `${type === 'bl' ? '黑' : '白'}名單${action === 'add' ? '新增' : '移除'}`, labelText);
                        await i.followUp({ content: `✅ 已${action === 'add' ? '新增' : '移除'} ${labelText}`, flags: 64 });
                    } else {
                        await i.followUp({ content: `⚠️ 操作失敗，可能已存在或不存在`, flags: 64 });
                    }
                    await showManagePanel(i, type === 'bl' ? 'bl' : 'wl');
                    } finally {
                        releasePrompt(uid);
                    }
                    break;
                }
                // 詐騙域名回報/新增/刪除（V0.2.7 自主學習）
                if (['scam_report', 'scam_add', 'scam_remove'].includes(i.customId)) {
                    if (!tryAcquirePrompt(uid)) return i.reply({ content: '⚠️ 已有進行中的操作，請先完成或等待超時', flags: 64 });
                    try {
                    const blNow = loadBlacklist();
                    blNow.scamDomains = blNow.scamDomains || [];
                    blNow.scamDomainMeta = blNow.scamDomainMeta || {};
                    const promptText = i.customId === 'scam_report'
                        ? '📩 請貼上可疑的詐騙連結（含 http）：'
                        : i.customId === 'scam_add'
                            ? '📝 請輸入要新增的詐騙域名（範例：evil-example.com）：'
                            : '📝 請輸入要刪除的詐騙域名：';
                    await i.reply({ content: promptText, flags: 64 });
                    const coll = await i.channel.awaitMessages({ filter: m => m.author.id === uid, max: 1, time: 60000 });
                    if (!coll.size) return i.followUp({ content: '⏰ 超時', flags: 64 });
                    const m = coll.first();
                    if (m.content.toLowerCase() === '取消') return i.followUp({ content: '❌ 已取消', flags: 64 });
                    const input = m.content.trim();
                    if (i.customId === 'scam_report') {
                        const url = extractUrls(input)[0];
                        if (!url) return i.followUp({ content: '❌ 找不到有效連結', flags: 64 });
                        let host;
                        try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return i.followUp({ content: '❌ 無效網址', flags: 64 }); }
                        if (!isValidDomain(host)) return i.followUp({ content: '⚠️ 網址格式無效，請提供合法網域', flags: 64 });
                        if (OFFICIAL_DOMAINS.some(o => host === o || host.endsWith('.' + o))) return i.followUp({ content: `ℹ️ \`${host}\` 是官方網站，不會被加入`, flags: 64 });
                        const meta = blNow.scamDomainMeta[host] = blNow.scamDomainMeta[host] || { reports: 0, hits: 0, addedBy: null, guildId: null, addedAt: Date.now(), source: '管理員回報' };
                        meta.reports++;
                        meta.addedBy = i.user.tag; meta.guildId = gid; meta.addedAt = Date.now(); meta.source = '管理員回報';
                        if (!blNow.scamDomains.includes(host)) blNow.scamDomains.push(host);
                        saveBlacklist(blNow);
                        logAdmin(i, '回報詐騙域名', host);
                        await i.followUp({ content: `✅ 已學習：\`${host}\`（回報 ${meta.reports} 次）`, flags: 64 });
                    } else if (i.customId === 'scam_add') {
                        const domain = input.toLowerCase();
                        if (!isValidDomain(domain)) return i.followUp({ content: '⚠️ 域名格式無效（僅允許 a-z/0-9/./-，最長 253 字元）', flags: 64 });
                        if (OFFICIAL_DOMAINS.some(o => domain === o || domain.endsWith('.' + o))) return i.followUp({ content: 'ℹ️ 官方域名不可加入', flags: 64 });
                        if (blNow.scamDomains.includes(domain)) return i.followUp({ content: `ℹ️ \`${domain}\` 已在清單`, flags: 64 });
                        blNow.scamDomains.push(domain);
                        blNow.scamDomainMeta[domain] = { reports: 1, hits: 0, addedBy: i.user.tag, guildId: gid, addedAt: Date.now(), source: '管理員新增' };
                        saveBlacklist(blNow);
                        logAdmin(i, '新增詐騙域名', domain);
                        await i.followUp({ content: `✅ 已新增：\`${domain}\``, flags: 64 });
                    } else {
                        const domain = input.toLowerCase();
                        if (!blNow.scamDomains.includes(domain)) return i.followUp({ content: `ℹ️ \`${domain}\` 不在清單`, flags: 64 });
                        blNow.scamDomains = blNow.scamDomains.filter(d => d !== domain);
                        delete blNow.scamDomainMeta[domain];
                        saveBlacklist(blNow);
                        logAdmin(i, '刪除詐騙域名', domain);
                        await i.followUp({ content: `✅ 已刪除：\`${domain}\``, flags: 64 });
                    }
                    await showScamPanel(i);
                    } finally {
                        releasePrompt(uid);
                    }
                    break;
                }
                // 自動回應
                if (i.customId === 'auto_add' || i.customId === 'auto_remove') {
                    if (!isDev) return i.reply({ content: '❌ 僅開發者', flags: 64 });
                    if (!tryAcquirePrompt(uid)) return i.reply({ content: '⚠️ 已有進行中的操作，請先完成或等待超時', flags: 64 });
                    try {
                    if (i.customId === 'auto_add') {
                        await i.reply({ content: '📝 格式：`觸發詞 | 回應`', flags: 64 });
                        const coll = await i.channel.awaitMessages({
                            filter: m => m.author.id === uid,
                            max: 1,
                            time: 60000
                        });
                        if (!coll.size) return i.followUp({ content: '⏰ 超時', flags: 64 });
                        const m = coll.first();
                        if (m.content.toLowerCase() === '取消') return i.followUp({ content: '❌ 已取消', flags: 64 });
                        const parts = m.content.split('|').map(s => s.trim());
                        if (parts.length < 2) return i.followUp({ content: '❌ 格式錯誤', flags: 64 });
                        const trigger = parts[0];
                        const response = parts.slice(1).join('|').trim();
                        if (!trigger || !response) return i.followUp({ content: '❌ 不能為空', flags: 64 });
                        // V0.2.5：自動回應防注入——禁止 @everyone/@here，限制回應長度
                        if (/@everyone|@here/i.test(response)) return i.followUp({ content: '❌ 回應不得包含 @everyone/@here', flags: 64 });
                        if (response.length > 1900) return i.followUp({ content: '❌ 回應過長（上限 1900 字元）', flags: 64 });
                        if (!config.autoResponses[gid]) config.autoResponses[gid] = {};
                        config.autoResponses[gid][trigger] = response;
                        saveConfig();
                        logAdmin(i, '新增回應', `${trigger}`);
                        await i.followUp({ content: `✅ 已新增：\`${trigger}\``, flags: 64 });
                        await showAutoPanel(i);
                    } else {
                        const responses = config.autoResponses[gid] || {};
                        if (!Object.keys(responses).length) {
                            return i.reply({ content: '⚠️ 無回應可移除', flags: 64 });
                        }
                        const list = Object.keys(responses).map((k, idx) => `${idx+1}. \`${k}\``).join('\n');
                        await i.reply({ content: `📝 輸入編號：\n${list}`, flags: 64 });
                        const coll = await i.channel.awaitMessages({
                            filter: m => m.author.id === uid,
                            max: 1,
                            time: 60000
                        });
                        if (!coll.size) return i.followUp({ content: '⏰ 超時', flags: 64 });
                        const m = coll.first();
                        if (m.content.toLowerCase() === '取消') return i.followUp({ content: '❌ 已取消', flags: 64 });
                        const num = parseInt(m.content.trim());
                        const keys = Object.keys(responses);
                        if (isNaN(num) || num < 1 || num > keys.length) {
                            return i.followUp({ content: `❌ 請輸入 1-${keys.length}`, flags: 64 });
                        }
                        const removed = keys[num - 1];
                        delete config.autoResponses[gid][removed];
                        if (!Object.keys(config.autoResponses[gid]).length) delete config.autoResponses[gid];
                        saveConfig();
                        logAdmin(i, '移除回應', removed);
                        await i.followUp({ content: `✅ 已移除：\`${removed}\``, flags: 64 });
                        await showAutoPanel(i);
                    }
                    } finally {
                        releasePrompt(uid);
                    }
                    break;
                }
        }
    } catch (e) {
        sysStatus.errors++;
        console.error('互動錯誤:', e);
        try { await i.reply({ content: '❌ 操作失敗', flags: 64 }); } catch (_) {}
    }
});

// V0.2.5：面板輸入互斥鎖——同一使用者同時只能有一個「等待輸入」流程，
// 防止重複點擊按鈕導致多個 awaitMessages 疊加互相干擾
const pendingPrompts = new Map();
function tryAcquirePrompt(userId) {
    if (pendingPrompts.get(userId)) return false;
    pendingPrompts.set(userId, true);
    return true;
}
function releasePrompt(userId) { pendingPrompts.delete(userId); }

async function showPanelFromInteraction(i) {
    try {
        // ===== 清理過時訊息 =====
        try {
            const fetched = await i.channel.messages.fetch({ limit: 20 });
            const botMessages = fetched.filter(m => m.author.id === client.user.id);
            if (botMessages.size > 1) {
                const sorted = botMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
                const toDelete = sorted.slice(1);
                for (const m of toDelete) {
                    await m.delete().catch(() => {});
                }
            }
        } catch (e) {}

        const gid = i.guildId;
        const guild = i.guild;
        const bl = loadBlacklist();
        const isDev = i.user.id === DEVELOPER_ID;
        const sec = getSecurity(gid);
        const alert = getAlert(gid);

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('sec').setLabel('🛡️ 安全設定').setStyle(3),
                new ButtonBuilder().setCustomId('alert').setLabel('🔔 警報設定').setStyle(2),
                new ButtonBuilder().setCustomId('refresh').setLabel('🔄 刷新').setStyle(2),
                new ButtonBuilder().setCustomId('scam').setLabel('🌐 詐騙域名').setStyle(1)
            );

        const row2 = new ActionRowBuilder();
        if (isDev) {
            row2.addComponents(
                new ButtonBuilder().setCustomId('bl').setLabel('📋 黑名單').setStyle(4),
                new ButtonBuilder().setCustomId('wl').setLabel('👑 白名單').setStyle(3),
                new ButtonBuilder().setCustomId('auto').setLabel('💬 自動回應').setStyle(1),
                new ButtonBuilder().setCustomId('export').setLabel('📤 匯出').setStyle(3),
                new ButtonBuilder().setCustomId('stop').setLabel('🛑 緊急停機').setStyle(4)
            );
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🐙 章魚防護系統')
            .setDescription('自動安全防護與管理面板')
            .addFields(
                { name: '📋 黑名單', value: `${bl.bannedUsers.length} 人`, inline: true },
                { name: '👑 白名單', value: `${config.whitelist.users.length + config.whitelist.roles.length} 個`, inline: true },
                { name: '🛡️ 安全', value: `${Object.values(sec).filter(v=>v).length}/${Object.keys(sec).length} 啟用`, inline: true },
                { name: '🔔 警報', value: `${Object.values(alert).filter(v=>v).length}/${Object.keys(alert).length} 啟用`, inline: true }
            )
            .setFooter({ text: `管理員 • ${guild.name}` })
            .setTimestamp();

        const components = [row1];
        if (row2.components.length > 0) components.push(row2);

        await i.message.edit({ embeds: [embed], components: components });
    } catch (e) {
        if (e.code === 10008) {
            // 訊息被刪，重新發送
            const gid = i.guildId;
            const guild = i.guild;
            const bl = loadBlacklist();
            const isDev = i.user.id === DEVELOPER_ID;
            const sec = getSecurity(gid);
            const alert = getAlert(gid);

            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('sec').setLabel('🛡️ 安全設定').setStyle(3),
                    new ButtonBuilder().setCustomId('alert').setLabel('🔔 警報設定').setStyle(2),
                    new ButtonBuilder().setCustomId('refresh').setLabel('🔄 刷新').setStyle(2),
                    new ButtonBuilder().setCustomId('scam').setLabel('🌐 詐騙域名').setStyle(1)
                );

            const row2 = new ActionRowBuilder();
            if (isDev) {
                row2.addComponents(
                    new ButtonBuilder().setCustomId('bl').setLabel('📋 黑名單').setStyle(4),
                    new ButtonBuilder().setCustomId('wl').setLabel('👑 白名單').setStyle(3),
                    new ButtonBuilder().setCustomId('auto').setLabel('💬 自動回應').setStyle(1),
                    new ButtonBuilder().setCustomId('export').setLabel('📤 匯出').setStyle(3),
                    new ButtonBuilder().setCustomId('stop').setLabel('🛑 緊急停機').setStyle(4)
                );
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🐙 章魚防護系統')
                .setDescription('自動安全防護與管理面板')
                .addFields(
                    { name: '📋 黑名單', value: `${bl.bannedUsers.length} 人`, inline: true },
                    { name: '👑 白名單', value: `${config.whitelist.users.length + config.whitelist.roles.length} 個`, inline: true },
                    { name: '🛡️ 安全', value: `${Object.values(sec).filter(v=>v).length}/${Object.keys(sec).length} 啟用`, inline: true },
                    { name: '🔔 警報', value: `${Object.values(alert).filter(v=>v).length}/${Object.keys(alert).length} 啟用`, inline: true }
                )
                .setFooter({ text: `管理員 • ${guild.name}` })
                .setTimestamp();

            const components = [row1];
            if (row2.components.length > 0) components.push(row2);

            await i.channel.send({ embeds: [embed], components: components });
            await i.reply({ content: '🔄 已重新發送面板', flags: 64 });
        } else {
            sysStatus.errors++;
            console.error('面板錯誤:', e);
            await i.reply({ content: '❌ 錯誤', flags: 64 }).catch(() => {});
        }
    }
}

// ============ 自動回應觸發 ============
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const responses = config.autoResponses[msg.guildId] || {};
    const content = msg.content.trim();
    for (const [trigger, response] of Object.entries(responses)) {
        if (content === trigger || content.startsWith(trigger + ' ')) {
            try { await msg.reply(response); } catch (_) {}
            break;
        }
    }
});

// ============ 惡意 Rich Presence ============
client.on(Events.PresenceUpdate, async (_, newP) => {
    if (!newP?.user || newP.user.bot) return;
    // 與訊息 XSS 偵測一致，只比對真正的注入樣式，不比對常見程式關鍵字
    const patterns = [/<script[\s\S]*?>/i, /<iframe[\s\S]*?>/i, /<object[\s\S]*?>/i, /<embed[\s\S]*?>/i,
        /javascript:\s*\S/i, /vbscript:\s*\S/i, /data:text\/html/i,
        /<[a-z]+[^>]+\son\w+\s*=\s*["']?[^"'>]+/i];
    for (const act of (newP.activities || [])) {
        const fields = [act.details, act.state, act.name].filter(Boolean);
        for (const field of fields) {
            for (const p of patterns) {
                if (p.test(field)) {
                    console.log(`⚠️ 惡意 RichP: ${newP.user.tag}`);
                    for (const g of (newP.guilds || [])) {
                        const gid = g.id;
                        if (gid && isAlertEnabled(gid, 'richPresence')) {
                            const embed = new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle('⚠️ 惡意 Rich Presence')
                                .setDescription(`**${newP.user.tag}** 使用惡意 RichP`)
                                .addFields({ name: '內容', value: field.slice(0, 100), inline: false })
                                .setTimestamp();
                            await sendAlert(gid, embed);
                        }
                        try {
                            const m = await g.members.fetch(newP.user.id);
                            if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                                await escalatePunishment(m, null, 'RichPresence', '狀態顯示含可疑注入樣式');
                            }
                        } catch (_) {}
                    }
                    return;
                }
            }
        }
    }
});

// ============ 核心檢測 ============
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const gid = msg.guildId;
    if (!gid) return;
    const sec = getSecurity(gid);
    const uid = msg.author.id;
    sysStatus.requests++;
    // V0.3.2：輸入層消毒——剝離零寬/隱形字元，防止插入隱形字元繞過偵測
    msg.content = sanitizeContent(msg.content);

    // 止損
    if (sec.stopLoss !== false && (msg.content.includes('@everyone') || msg.content.includes('@here'))) {
        const r = DETECT.stopLoss(uid, gid);
        if (r) {
            console.log(`⚠️ 止損: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await escalatePunishment(m, msg.channel, '止損', `止損 - ${r.reason}`);
                    await msg.delete().catch(() => {});
                }
            } catch (_) {}
            return;
        }
    }

    // @mention
    if (sec.mentionSpeed !== false) {
        const cnt = (msg.content.match(/<@[!&]?\d+>/g) || []).length;
        if (cnt >= 3) {
            const r = DETECT.mentionSpeed(uid, gid);
            if (r) {
                console.log(`⚠️ @mention: ${msg.author.tag}`);
                try {
                    const m = await msg.guild.members.fetch(uid);
                    if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                        await escalatePunishment(m, msg.channel, '@mention', `@mention - ${r.reason}`);
                        await msg.delete().catch(() => {});
                    }
                } catch (_) {}
                return;
            }
        }
    }

    // 腳本
    if (sec.scriptDetection !== false) {
        const r = DETECT.script(uid, gid);
        if (r) {
            console.log(`⚠️ 腳本: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await escalatePunishment(m, msg.channel, '腳本', `腳本 - ${r.reason}`);
                    await msg.delete().catch(() => {});
                }
            } catch (_) {}
        }
    }

    // SelfBot
    if (sec.selfbotDetection !== false) {
        const r = DETECT.selfbot(uid, gid);
        if (r) {
            console.log(`⚠️ SelfBot: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await escalatePunishment(m, msg.channel, 'SelfBot', `SelfBot - ${r.reason}`);
                }
            } catch (_) {}
        }
    }

    // 洪水
    if (sec.floodProtection !== false) {
        const r = DETECT.flood(uid, gid);
        if (r) {
            console.log(`⚠️ 洪水: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await escalatePunishment(m, msg.channel, '洪水', `洪水 - ${r.reason}`);
                    await msg.delete().catch(() => {});
                }
            } catch (_) {}
        }
    }

    // 詐騙連結（V0.2.5；V0.2.9 加入混淆網址還原與短網址偵測）
    if (sec.scamLink !== false) {
        const rawUrls = [...extractUrls(msg.content || ''), ...extractObfuscatedUrls(msg.content || '')];
        const hit = rawUrls.map(u => ({ url: u, reason: getScamReason(u) })).find(x => x.reason);
        if (hit) {
            // V0.2.9：短網址服務僅記錄與警示，不刪除訊息（避免誤刪合法短連結）
            if (hit.reason.startsWith('短網址')) {
                console.log(`📎 短網址: ${msg.author.tag} -> ${hit.url.slice(0, 80)}`);
                if (isAlertEnabled(gid, 'scamLink')) {
                    try {
                        const embed = new EmbedBuilder()
                            .setColor(0xffa500)
                            .setTitle('📎 短網址偵測')
                            .setDescription(`**${msg.author.tag}** 發送了短網址連結`)
                            .addFields({ name: '連結', value: hit.url.slice(0, 120), inline: false })
                            .addFields({ name: '原因', value: hit.reason, inline: false })
                            .setTimestamp();
                        await sendAlert(gid, embed);
                    } catch (_) {}
                }
            } else {
                // V0.2.7：自主學習統計——自訂域名累計命中次數；偽官方域名進學習池
                try {
                    const hitHost = new URL(hit.url).hostname.toLowerCase();
                    const blNow = loadBlacklist();
                    if ((blNow.scamDomains || []).includes(hitHost)) {
                        const mm = (blNow.scamDomainMeta = blNow.scamDomainMeta || {})[hitHost] = (blNow.scamDomainMeta[hitHost] || { hits: 0 });
                        mm.hits = (mm.hits || 0) + 1;
                        mm.lastHit = Date.now();
                    } else if (hit.reason.includes('疑似偽裝') && isValidDomain(hitHost)) {
                        recordScamCandidate(hitHost);
                    }
                } catch (_) {}
                console.log(`⚠️ 詐騙連結: ${msg.author.tag} -> ${hit.url.slice(0, 80)}`);
                try {
                    const m = await msg.guild.members.fetch(uid);
                    if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                        await msg.delete().catch(() => {});
                        await escalatePunishment(m, msg.channel, '詐騙連結', `偵測到可疑連結：${hit.reason}，訊息已刪除`, { strong: true });
                    }
                } catch (_) {}
            }
            return;
        }
    }

    // V0.3.0：純文字釣魚偵測——無連結的贈禮/驗證話術，僅警示不刪除
    if (sec.scamLink !== false) {
        const txt = detectTextScam(msg.content);
        const noUrl = !extractUrls(msg.content || '').length && !extractObfuscatedUrls(msg.content || '').length;
        if (txt && noUrl) {
            console.log(`⚠️ 文字釣魚: ${msg.author.tag} -> ${txt}`);
            if (isAlertEnabled(gid, 'scamLink')) {
                try {
                    const embed = new EmbedBuilder()
                        .setColor(0xffa500)
                        .setTitle('⚠️ 釣魚話術')
                        .setDescription(`**${msg.author.tag}** 發送疑似釣魚文字`)
                        .addFields({ name: '原因', value: txt, inline: false })
                        .setTimestamp();
                    await sendAlert(gid, embed);
                } catch (_) {}
            }
        }
    }

    // V0.3.3：進階注入偵測——SQL/命令/模板注入樣式（僅警示，不刪除不處罰）
    if (sec.injectionDetection !== false) {
        const inj = detectInjection(msg.content);
        if (inj && isAlertEnabled(gid, 'contentAbuse')) {
            console.log(`⚠️ 注入樣式: ${msg.author.tag} -> ${inj}`);
            try {
                const embed = new EmbedBuilder()
                    .setColor(0xff6600)
                    .setTitle('⚠️ 注入攻擊樣式')
                    .setDescription(`**${msg.author.tag}** 發送疑似注入內容`)
                    .addFields({ name: '原因', value: inj, inline: false })
                    .setTimestamp();
                await sendAlert(gid, embed);
            } catch (_) {}
        }
    }

    // V0.3.3：資源耗盡防禦——超長訊息/超多附件只警示，跳過重量級偵測避免 DoS
    if (msg.content.length > 4000) {
        if (isAlertEnabled(gid, 'contentAbuse')) {
            try {
                const embed = new EmbedBuilder()
                    .setColor(0xff6600)
                    .setTitle('⚠️ 超長訊息')
                    .setDescription(`**${msg.author.tag}** 發送 ${msg.content.length} 字元訊息（上限 4000）`)
                    .setTimestamp();
                await sendAlert(gid, embed);
            } catch (_) {}
        }
        return;
    }
    if (msg.attachments.size > 5) {
        if (isAlertEnabled(gid, 'contentAbuse')) {
            try {
                const embed = new EmbedBuilder()
                    .setColor(0xff6600)
                    .setTitle('⚠️ 附件炸彈')
                    .setDescription(`**${msg.author.tag}** 單則訊息附帶 ${msg.attachments.size} 個附件`)
                    .setTimestamp();
                await sendAlert(gid, embed);
            } catch (_) {}
        }
    }

    // 重複內容（V0.2.5）
    if (sec.duplicateSpam !== false) {
        const d = checkDuplicate(uid, gid, msg.content);
        if (d) {
            console.log(`⚠️ 重複內容: ${msg.author.tag} (${d.count}次/30秒)`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await escalatePunishment(m, msg.channel, '重複內容', '短時間內重複發送相同內容');
                }
            } catch (_) {}
        }
    }

    // @everyone/@here 濫用（V0.2.6）：60 秒內 ≥3 次觸發，刪訊息＋警告（管理員/白名單豁免）
    if (sec.mentionSpam !== false && /@everyone|@here/.test(msg.content || '')) {
        const mnt = trackMention(uid);
        if (mnt) {
            console.log(`⚠️ @everyone 濫用: ${msg.author.tag} (${mnt.count}次/60秒)`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await msg.delete().catch(() => {});
                    await warnUser(m, msg.channel, `短時間內多次 @everyone/@here（${mnt.count} 次）`, '@everyone 濫用');
                }
            } catch (_) {}
        }
    }

    // 爬蟲
    if (sec.crawlerDetection !== false) {
        const r = DETECT.crawler(uid, gid);
        if (r) {
            console.log(`⚠️ 爬蟲: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await m.timeout(60000, `🐙 爬蟲 - ${r.reason}`);
                }
            } catch (_) {}
        }
    }

    // XSS（僅比對真正具攻擊性的樣式；略過程式碼區塊；一般程式討論常用的
    // document./window./console./fetch(/eval( 等單詞已移除，避免誤判技術頻道）
    if (sec.xssProtection !== false) {
        const content = (msg.content || '')
            .replace(/```[\s\S]*?```/g, '')   // 略過多行程式碼區塊
            .replace(/`[^`]*`/g, '');          // 略過行內程式碼
        const patterns = [
            /<script[\s\S]*?>/gi, /<iframe[\s\S]*?>/gi, /<object[\s\S]*?>/gi, /<embed[\s\S]*?>/gi,
            /javascript:\s*\S/gi, /vbscript:\s*\S/gi, /data:text\/html/gi,
            /<[a-z]+[^>]+\son\w+\s*=\s*["']?[^"'>]+/gi   // <tag ... onXXX=...> 才算，單獨的 onXXX= 不算
        ];
        if (patterns.some(p => p.test(content))) {
            console.log(`⚠️ XSS: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await msg.delete().catch(() => {});
                    await escalatePunishment(m, msg.channel, 'XSS', '偵測到可疑的網頁注入樣式，訊息已刪除', { strong: true });
                }
            } catch (_) {}
            return;
        }
    }

    // 惡意檔案
    if (sec.maliciousFile !== false && msg.attachments?.size) {
        // 已移除 .js / .jar：這兩種副檔名常被開發者或 Minecraft 社群正常分享，
        // 容易造成誤封；真正危險的可執行檔類型維持自動處理
        const exts = ['.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.vbs'];
        const mimes = ['application/x-msdownload', 'application/x-executable', 'application/java-archive'];
        for (const att of msg.attachments.values()) {
            const ext = att.name?.substring(att.name.lastIndexOf('.')).toLowerCase() || '';
            const ct = att.contentType || '';
            if (exts.includes(ext) || mimes.some(t => ct.includes(t))) {
                console.log(`⚠️ 惡意檔案: ${att.name}`);
                try {
                    const m = await msg.guild.members.fetch(uid);
                    if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                        await msg.delete().catch(() => {});
                        await escalatePunishment(m, msg.channel, '惡意檔案', `惡意檔案: ${att.name}`, { strong: true });
                    }
                } catch (_) {}
                return;
            }
        }
    }
});

// ============ 語音濫用 ============
client.on(Events.VoiceStateUpdate, async (old, now) => {
    const uid = old.member?.id || now.member?.id;
    if (!uid || old.member?.user.bot) return;
    const gid = old.guild?.id || now.guild?.id;
    if (!gid) return;
    if (getSecurity(gid).voiceAbuse === false) return;
    const r = DETECT.voice(uid, gid);
    if (r) {
        console.log(`⚠️ 語音濫用: ${old.member?.user?.tag || '未知'}`);
        try {
            const m = old.member || now.member;
            if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                await escalatePunishment(m, null, '語音濫用', `語音濫用 - ${r.reason}`);
            }
        } catch (_) {}
    }
});

// ============ Webhook ============
client.on(Events.WebhookUpdate, async (ch) => {
    const gid = ch.guild.id;
    if (getSecurity(gid).webhookMonitor === false) return;
    try {
        const hooks = await ch.fetchWebhooks();
        const recent = hooks.filter(w => Date.now() - w.createdTimestamp < 60000);
        // V0.2.9：Webhook 名稱假冒偵測（仿冒 discord/steam/nitro 官方或贈禮）
        for (const w of recent) {
            if (isHookImpersonating(w.name) && isAlertEnabled(gid, 'webhookAbuse')) {
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('⚠️ 假冒 Webhook')
                    .setDescription(`偵測到名稱仿冒官方的 Webhook：**${w.name}**`)
                    .addFields({ name: '頻道', value: `<#${ch.id}>`, inline: true })
                    .setTimestamp();
                await sendAlert(gid, embed);
            }
        }
        if (recent.size > 3 && isAlertEnabled(gid, 'webhookAbuse')) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ Webhook 濫用')
                .setDescription(`頻道 ${ch.name} 在1分鐘內建立 ${recent.size} 個 Webhook`)
                .addFields({ name: '頻道', value: `<#${ch.id}>`, inline: true })
                .setTimestamp();
            await sendAlert(gid, embed);
        }
    } catch (_) {}
});

client.on(Events.MessageCreate, async (msg) => {
    if (!msg.webhookId) return;
    const gid = msg.guildId;
    if (!gid || getSecurity(gid).webhookMonitor === false) return;
    const r = DETECT.webhook(msg.webhookId, gid);
    if (r) {
        console.log(`⚠️ Webhook 濫用: ${msg.webhookId}`);
        try {
            const hooks = await msg.channel.fetchWebhooks();
            const hook = hooks.find(w => w.id === msg.webhookId);
            if (hook) {
                await hook.delete('🐙 Webhook 濫用');
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('🗑️ Webhook 已刪除')
                    .setDescription('偵測到濫用，已自動刪除')
                    .addFields({ name: '名稱', value: hook.name || '未命名', inline: true })
                    .setTimestamp();
                await msg.channel.send({ embeds: [embed] });
            }
        } catch (_) {}
    }
});

// ============ 權限變更 ============
client.on(Events.ChannelUpdate, async (old, now) => {
    const gid = now.guildId;
    if (!gid || getSecurity(gid).permissionSpam === false) return;
    const oldP = old.permissionOverwrites?.cache?.map(p => `${p.id}_${p.type}_${p.allow}_${p.deny}`).join('|') || '';
    const newP = now.permissionOverwrites?.cache?.map(p => `${p.id}_${p.type}_${p.allow}_${p.deny}`).join('|') || '';
    if (oldP === newP) return;
    const r = DETECT.permSpam(gid, now.id);
    if (r && isAlertEnabled(gid, 'permissionAbuse')) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⚠️ 權限變更異常')
            .setDescription(`頻道 ${now.name} 在 ${r.reason}`)
            .addFields({ name: '頻道', value: `<#${now.id}>`, inline: true })
            .setTimestamp();
        await sendAlert(gid, embed);
    }
});

// ============ 伺服器加入/離開（V0.2.5）============
client.on(Events.GuildCreate, async (guild) => {
    console.log(`✅ 加入新伺服器: ${guild.name}`);
    getSecurity(guild.id); // 建立預設安全設定
    saveConfig();
    await scanAll(); // 立即套用全域黑名單
    checkImposterBots().catch(() => {}); // V0.2.6：掃描是否有假冒本機器人的其他機器人
});

client.on(Events.GuildDelete, (guild) => {
    console.warn(`🚫 已離開伺服器: ${guild.name || guild.id}（可能被移除或機器人被踢）`);
    logAction('GUILD_LEFT', { guildId: guild.id, guildName: guild.name || '未知' });
});

// ============ 成員加入 ============
client.on(Events.GuildMemberAdd, async (m) => {
    const gid = m.guild.id;
    const sec = getSecurity(gid);

    // V0.2.6：加入即查全域黑名單（不必等 scanAll 定時掃描）
    if (sec.honorGlobalBlacklist !== false) {
        const bl = loadBlacklist();
        if (bl.bannedUsers.includes(m.id)) {
            console.log(`🔨 即時黑名單: ${m.user.tag} 加入 ${m.guild.name}，立即封鎖`);
            try { await banUser(m, '🐙 全域黑名單', '加入即封鎖', null, false); } catch (_) {}
            return;
        }
    }

    // V0.3.0：大量加入防護（raid 偵測）——僅警示，不自動處理，避免誤傷正常加入
    const joinCount = trackJoin(gid);
    if (joinCount >= 5 && isAlertEnabled(gid, 'suspiciousAccount')) {
        try {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('🚨 大量成員加入')
                .setDescription(`**${m.guild.name}** 在 60 秒內有 ${joinCount} 個新成員加入`)
                .addFields({ name: 'ID', value: m.user.id, inline: true })
                .setTimestamp();
            await sendAlert(gid, embed);
        } catch (_) {}
    }

    if (sec.suspiciousAccount !== false) {
        const r = isSuspicious(m.user);
        if (r.suspicious && isAlertEnabled(gid, 'suspiciousAccount')) {
            const embed = new EmbedBuilder()
                .setColor(0xffaa00)
                .setTitle('⚠️ 可疑帳號')
                .setDescription(`**${m.user.tag}** 加入`)
                .addFields(
                    { name: '原因', value: r.reason, inline: false },
                    { name: 'ID', value: m.user.id, inline: true }
                )
                .setTimestamp();
            await sendAlert(gid, embed);
        }
        // 已移除「帳號 <3天 就自動 Ban」的規則：帳號新不代表是惡意帳號，
        // 這條規則過去很容易誤封剛加入社群的正常新使用者。
        // 若要自動處理可疑新帳號，建議搭配 collusionAttack（撞庫）等行為型偵測，
        // 而不是單憑帳號年齡直接封鎖。
    }

    // V0.2.5：假冒名稱偵測（名稱含 discord/steam+贈禮關鍵字組合）
    if (sec.impersonation !== false) {
        const imp = isImpersonating(m.user);
        if (imp && isAlertEnabled(gid, 'suspiciousAccount')) {
            const embed = new EmbedBuilder()
                .setColor(0xffaa00)
                .setTitle('⚠️ 疑似假冒帳號')
                .setDescription(`**${m.user.tag}** 名稱疑似假冒官方或贈禮帳號`)
                .addFields({ name: '原因', value: imp, inline: false })
                .setTimestamp();
            await sendAlert(gid, embed);
        }
    }

    if (sec.collusionAttack !== false) {
        const r = DETECT.collusion(m.id, gid);
        if (r) {
            console.log(`⚠️ 撞庫: ${m.user.tag}`);
            try {
                await escalatePunishment(m, null, '撞庫', `撞庫 - ${r.reason}`, { strong: true });
            } catch (_) {}
        }
    }

    if (sec.floodJoin !== false) {
        const r = DETECT.join(gid);
        if (r && isAlertEnabled(gid, 'floodJoin')) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ 洪水加入')
                .setDescription(`${m.guild.name} 在 ${r.reason}`)
                .addFields(
                    { name: '伺服器', value: m.guild.name, inline: true },
                    { name: '成員數', value: `${m.guild.memberCount} 人`, inline: true }
                )
                .setTimestamp();
            await sendAlert(gid, embed);
        }
    }
});

// ============ 邀請 ============
client.on(Events.InviteCreate, async (inv) => {
    const gid = inv.guild.id;
    if (getSecurity(gid).inviteMonitor === false || !inv.inviter) return;
    const r = DETECT.invite(inv.inviter.id, gid);
    if (r) {
        console.log(`⚠️ 邀請濫用: ${inv.inviter.tag}`);
        if (isAlertEnabled(gid, 'inviteAbuse')) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ 邀請濫用')
                .setDescription(`${inv.inviter.tag} 在 ${r.reason}`)
                .addFields({ name: '使用者', value: `<@${inv.inviter.id}>`, inline: true })
                .setTimestamp();
            await sendAlert(gid, embed);
        }
        try {
            const m = await inv.guild.members.fetch(inv.inviter.id);
            if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                await escalatePunishment(m, null, '邀請濫用', `邀請濫用 - ${r.reason}`);
            }
        } catch (_) {}
    }
});

// ============ 角色權限 ============
client.on(Events.GuildRoleUpdate, async (old, now) => {
    const gid = now.guild.id;
    if (getSecurity(gid).roleLock === false) return;
    const oldA = old.permissions.has(PermissionFlagsBits.Administrator);
    const newA = now.permissions.has(PermissionFlagsBits.Administrator);
    if (!oldA && newA) {
        console.log(`⚠️ 權限提升: ${now.name}`);
        if (isAlertEnabled(gid, 'roleAbuse')) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚠️ 權限提升')
                .setDescription(`角色 ${now.name} 被賦予管理員權限`)
                .addFields({ name: '角色', value: `<@&${now.id}>`, inline: true })
                .setTimestamp();
            await sendAlert(gid, embed);
        }
        try {
            await now.setPermissions(now.permissions.remove(PermissionFlagsBits.Administrator));
            console.log(`🔒 已復原: ${now.name}`);
        } catch (_) {}
    }
});

// ============ 頻道建立/刪除 ============
client.on(Events.ChannelCreate, async (ch) => {
    const gid = ch.guild.id;
    if (getSecurity(gid).channelSpam === false) return;
    const r = DETECT.channelSpam(gid, 'create');
    if (r && isAlertEnabled(gid, 'channelSpam')) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⚠️ 頻道建立濫用')
            .setDescription(`${ch.guild.name} 在 ${r.reason}`)
            .addFields({ name: '伺服器', value: ch.guild.name, inline: true })
            .setTimestamp();
        await sendAlert(gid, embed);
    }
});

client.on(Events.ChannelDelete, async (ch) => {
    const gid = ch.guild.id;
    if (getSecurity(gid).channelSpam === false) return;
    const r = DETECT.channelSpam(gid, 'delete');
    if (r && isAlertEnabled(gid, 'channelSpam')) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('⚠️ 頻道刪除濫用')
            .setDescription(`${ch.guild.name} 在 ${r.reason}`)
            .addFields({ name: '伺服器', value: ch.guild.name, inline: true })
            .setTimestamp();
        await sendAlert(gid, embed);
    }
});

// ============ 清理 ============
setInterval(cleanupTrackers, 60000);

// V0.2.6：記憶體感知——RSS 高水位時自動縮短掃描間隔並加強清理，低於警戒後回復
let scanIntervalMs = 30 * 60 * 1000;
let lastScanTs = 0;
function memoryCheck() {
    const rss = process.memoryUsage().rss / 1048576;
    const mb = () => Math.round(rss);
    if (rss > 260) {
        if (scanIntervalMs !== 6 * 60 * 1000) {
            scanIntervalMs = 6 * 60 * 1000;
            console.warn(`⚠️ 記憶體高水位 (${mb()}MB)，掃描間隔縮短至 6 分鐘`);
        }
        cleanupTrackers();
        pruneScamCandidates();
    } else if (rss > 180) {
        if (scanIntervalMs !== 10 * 60 * 1000) {
            scanIntervalMs = 10 * 60 * 1000;
            console.warn(`⚠️ 記憶體偏高 (${mb()}MB)，掃描間隔縮短至 10 分鐘`);
        }
    } else if (scanIntervalMs !== 30 * 60 * 1000) {
        scanIntervalMs = 30 * 60 * 1000;
        console.log(`✅ 記憶體恢復正常 (${mb()}MB)，掃描間隔回復 30 分鐘`);
    }
    return rss;
}
setInterval(memoryCheck, 60000);
setInterval(async () => {
    if (Date.now() - lastScanTs >= scanIntervalMs) {
        lastScanTs = Date.now();
        console.log('🔄 定期掃描...');
        await scanAll();
    }
}, 60000);

// ============ 全域錯誤處理 ============
// 防止任何單一 Promise 拒絕或未捕捉例外導致整個機器人靜默退出，
// 並將錯誤寫入 crash.log 以便追查根因。
function writeCrash(type, err) {
    const line = `[${new Date().toISOString()}] ${type}: ${err && err.stack ? err.stack : String(err)}\n`;
    console.error(type === 'uncaughtException' ? '💥' : '🚨', maskToken(err && err.message ? err.message : err));
    try { fs.appendFileSync(path.join(__dirname, 'crash.log'), maskToken(line)); } catch (_) {}
}
process.on('unhandledRejection', (reason) => { writeCrash('unhandledRejection', reason); });
// V0.3.0：Discord 斷線/無效連線記錄（不退出，discord.js 會自行重連）
client.on(Events.ShardDisconnect, (e, id) => writeCrash('shardDisconnect', (e && e.message ? e : new Error(`shard ${id} 斷線`))));
process.on('uncaughtException', (err) => {
    writeCrash('uncaughtException', err);
    flushPendingWrites();
    process.exit(1); // 狀態可能已不一致，交由 systemd 重啟
});
// V0.2.4：監聽 discord.js 的 error/warn 事件（未監聽的 error 事件會直接讓 Node 崩潰）
client.on('error', (e) => writeCrash('clientError', e));
client.on('warn', (w) => console.warn('⚠️', maskToken(w && w.message ? w.message : w)));
// V0.2.4：停止前強制寫出未落盤的日誌緩衝，避免資料遺失
process.on('SIGTERM', () => { flushPendingWrites(); releaseInstanceLock(); process.exit(0); });
process.on('SIGINT', () => { flushPendingWrites(); releaseInstanceLock(); process.exit(0); });

// ============ 啟動（含登入失敗重試） ============
// V0.2.5：啟動前驗證環境設定，避免缺少 token 時無限重試循環
function validateEnv() {
    if (!process.env.DISCORD_TOKEN) {
        console.error('❌ 缺少 DISCORD_TOKEN（請檢查 .env 檔案）');
        return false;
    }
    if (process.env.DISCORD_TOKEN.length < 30) {
        console.error('❌ DISCORD_TOKEN 格式異常（長度過短，請檢查 .env 檔案）');
        return false;
    }
    return true;
}

async function startBot() {
    console.log(`🕐 [${new Date().toLocaleString('zh-TW')}] 正在登入 Discord...`);
    try {
        await client.login(process.env.DISCORD_TOKEN);
    } catch (e) {
        console.error(`🚨 登入失敗: ${e.message}，30 秒後重試`);
        setTimeout(startBot, 30000);
    }
}
if (!validateEnv()) process.exit(1);
// V0.3.0：啟動自檢——顯示版本、平台與資料目錄，方便除錯定位
try {
    const pkg = require('./package.json');
    console.log(`🐙 OctopCutes-Bot v${pkg.version} | 平台: ${process.platform} | Node: ${process.version} | 目錄: ${__dirname}`);
} catch (_) {}
// V0.3.0：記憶體可觀測性——每 6 小時記錄 RSS/heap，供每日維護比對記憶體趨勢
setInterval(() => {
    const mu = process.memoryUsage();
    console.log(`📊 記憶體: ${(mu.rss / 1048576).toFixed(1)}MB RSS | ${(mu.heapUsed / 1048576).toFixed(1)}MB heap`);
}, 6 * 60 * 60 * 1000);

// ============ V0.2.6 啟動防護 ============
// 單實例鎖：防止重複啟動雙實例同時操作設定檔/黑名單造成衝突
const LOCK_FILE = require('path').join(require('os').tmpdir(), 'octopus-bot.lock');
function acquireInstanceLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
            if (oldPid && Number.isInteger(oldPid) && oldPid > 0) {
                try { process.kill(oldPid, 0); console.error(`❌ 另一個實例正在運行 (PID ${oldPid})，拒絕啟動`); process.exit(1); }
                catch (e) { /* PID 已不存在，可覆寫 */ }
            }
        }
        fs.writeFileSync(LOCK_FILE, String(process.pid));
        console.log(`🔒 單實例鎖已取得 (PID ${process.pid})`);
    } catch (e) { console.warn(`⚠️ 無法建立實例鎖: ${e.message}`); }
}
function releaseInstanceLock() {
    try {
        if (fs.existsSync(LOCK_FILE) && fs.readFileSync(LOCK_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(LOCK_FILE);
    } catch (_) {}
}
// .env 權限檢查（僅 Unix）：group/other 可讀時警告，防止 token 被其他使用者竊取
function checkEnvFilePerm() {
    if (process.platform === 'win32') return;
    try {
        const st = fs.statSync(path.join(__dirname, '.env'));
        if (st.mode & 0o077) console.warn(`⚠️ .env 權限過寬 (${(st.mode & 0o777).toString(8)})，建議 chmod 600 .env`);
    } catch (_) {}
}

acquireInstanceLock();
checkEnvFilePerm();
startBot();
// V0.2.6：啟動後 60 秒與每 6 小時掃描機器人同名假冒
setTimeout(() => checkImposterBots().catch(() => {}), 60000);
setInterval(() => checkImposterBots().catch(() => {}), 6 * 60 * 60 * 1000);