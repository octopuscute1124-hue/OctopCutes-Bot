require('dotenv').config();
const fs = require('fs');
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

const BLACKLIST_FILE = './blacklist.json';
const CONFIG_FILE = './config.json';
const LOG_FILE = './logs.json';

// ============ 工具函數 ============
function loadJSON(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { console.error(`讀取 ${file} 失敗:`, e.message); }
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
function loadBlacklist() { return loadJSON(BLACKLIST_FILE, { bannedUsers: [] }); }
function saveBlacklist(data) { saveJSON(BLACKLIST_FILE, data); }

function addToBlacklist(userId) {
    const data = loadBlacklist();
    if (!data.bannedUsers.includes(userId)) {
        data.bannedUsers.push(userId);
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
        rateLimit: true, autoDegrade: true, commandWhitelist: true, inviteMonitor: true,
        roleLock: true, channelSpam: true, logRetention: 30
    };
}

function getDefaultAlert() {
    return {
        suspiciousAccount: true, floodJoin: true, webhookAbuse: true, permissionAbuse: true,
        botBanned: true, channelSpam: true, roleAbuse: true, inviteAbuse: true, richPresence: true
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
            config.security[gid] = { ...getDefaultSecurity(), ...s };
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
function logAction(action, details) {
    let logs = loadJSON(LOG_FILE, []);
    logs.push({ timestamp: new Date().toISOString(), action, details });
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    logs = logs.filter(l => new Date(l.timestamp).getTime() > cutoff).slice(-5000);
    saveJSON(LOG_FILE, logs);
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
async function banUser(member, reason, logReason, channel = null) {
    try {
        await member.ban({ reason, deleteMessageDays: 7 });
        if (addToBlacklist(member.id)) console.log(`📋 黑名單: ${member.user.tag}`);
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
                    { name: '黑名單', value: `${loadBlacklist().bannedUsers.length} 人`, inline: true },
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

function cleanupTrackers() {
    const now = Date.now();
    for (const [key, data] of trackers) {
        data.times = data.times.filter(t => now - t < 60000);
        if (data.times.length === 0 && now - data.last > 60000) trackers.delete(key);
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

async function scanAll() {
    const blacklist = loadBlacklist();
    if (blacklist.bannedUsers.length === 0) { console.log('📋 黑名單為空'); return; }
    console.log(`🔍 掃描 ${client.guilds.cache.size} 個伺服器...`);
    let total = 0;
    for (const [, guild] of client.guilds.cache) {
        try {
            const members = await guild.members.fetch();
            for (const userId of blacklist.bannedUsers) {
                const m = members.get(userId);
                if (m && !m.user.bot) {
                    if (await banUser(m, '🐙 全域黑名單', '全域掃描')) total++;
                }
            }
        } catch (e) { console.log(`⚠️ ${guild.name}: ${e.message}`); }
    }
    console.log(`✅ 共封鎖 ${total} 人`);
}

// ============ 主面板 ============
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || msg.content.trim() !== '!章魚') return;
    if (!msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return msg.reply('❌ 需要管理員權限！');
    }
    await showPanel(msg);
});

async function showPanel(msg) {
    const gid = msg.guildId;
    const guild = msg.guild;
    const bl = loadBlacklist();
    const isDev = msg.author.id === DEVELOPER_ID;
    const sec = getSecurity(gid);
    const alert = getAlert(gid);

    const secCount = Object.values(sec).filter(v => v).length;
    const alertCount = Object.values(alert).filter(v => v).length;

    // 第一行：主要功能
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('sec').setLabel('🛡️ 安全設定').setStyle(3),
            new ButtonBuilder().setCustomId('alert').setLabel('🔔 警報設定').setStyle(2),
            new ButtonBuilder().setCustomId('refresh').setLabel('🔄 刷新').setStyle(2)
        );

    // 第二行：開發者功能（只有開發者看到）
    const row2 = new ActionRowBuilder();
    if (isDev) {
        row2.addComponents(
            new ButtonBuilder().setCustomId('bl').setLabel('📋 黑名單').setStyle(4),
            new ButtonBuilder().setCustomId('wl').setLabel('👑 白名單').setStyle(3),
            new ButtonBuilder().setCustomId('auto').setLabel('💬 自動回應').setStyle(1),
            new ButtonBuilder().setCustomId('export').setLabel('📤 匯出').setStyle(3)
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

    // 組合成兩行
    const components = [row1];
    if (row2.components.length > 0) components.push(row2);

    await msg.reply({ embeds: [embed], components: components });
}

// ============ 安全設定面板 ============
async function showSecurityPanel(i) {
    const gid = i.guildId;
    const sec = getSecurity(gid);
    const features = [
        ['stopLoss', '止損'], ['mentionSpeed', '@mention'], ['scriptDetection', '腳本'],
        ['voiceAbuse', '語音'], ['webhookMonitor', 'Webhook'], ['selfbotDetection', 'SelfBot'],
        ['floodProtection', '洪水'], ['floodJoin', '洪水加入'], ['permissionSpam', '權限變更'],
        ['maliciousFile', '惡意檔案'], ['xssProtection', 'XSS'], ['richPresence', 'RichP'],
        ['crawlerDetection', '爬蟲'], ['collusionAttack', '撞庫'], ['suspiciousAccount', '可疑帳號'],
        ['bruteForce', '暴力破解'], ['rateLimit', 'RateLimit'], ['autoDegrade', '降級'],
        ['commandWhitelist', '指令白名單'], ['inviteMonitor', '邀請'], ['roleLock', '角色鎖定'],
        ['channelSpam', '頻道監控']
    ];

    // 只顯示前 20 個（4行 x 5個）
    const displayFeatures = features.slice(0, 20);
    const rows = [];
    let row = new ActionRowBuilder();
    let count = 0;

    for (const [k, name] of displayFeatures) {
        const status = sec[k] !== undefined ? sec[k] : true;
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`sec_${k}`)
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

    // 狀態文字（只顯示前 20 個）
    const statusText = displayFeatures.map(([k, name]) => {
        const s = sec[k] !== undefined ? sec[k] : true;
        return `${s ? '✅' : '❌'} ${name}`;
    }).join('\n');

    // 返回按鈕單獨一行
    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('back').setLabel('🔙 返回').setStyle(2)
        );
    rows.push(backRow);

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🛡️ 安全設定')
        .setDescription('點擊切換開關 (顯示前20項)')
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

// ============ 互動處理 ============
client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton()) return;
    if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return i.reply({ content: '❌ 需要管理員權限！', flags: 64 });
    }
    if (!checkRateLimit(i.user.id)) {
        return i.reply({ content: '⚠️ 操作過頻繁', flags: 64 });
    }
    if (checkSystem() === 'emergency') {
        return i.reply({ content: '🚨 系統保護模式', flags: 64 });
    }
    if (trackBehavior(i.user.id)) {
        return i.reply({ content: '⚠️ 異常行為', flags: 64 });
    }

    const gid = i.guildId;
    const uid = i.user.id;
    const isDev = uid === DEVELOPER_ID;

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
                break;
            default:
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
                    break;
                }
                // 自動回應
                if (i.customId === 'auto_add' || i.customId === 'auto_remove') {
                    if (!isDev) return i.reply({ content: '❌ 僅開發者', flags: 64 });
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
                    break;
                }
        }
    } catch (e) {
        console.error('互動錯誤:', e);
        try { await i.reply({ content: '❌ 操作失敗', flags: 64 }); } catch (_) {}
    }
});

async function showPanelFromInteraction(i) {
    try {
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
                new ButtonBuilder().setCustomId('refresh').setLabel('🔄 刷新').setStyle(2)
            );

        const row2 = new ActionRowBuilder();
        if (isDev) {
            row2.addComponents(
                new ButtonBuilder().setCustomId('bl').setLabel('📋 黑名單').setStyle(4),
                new ButtonBuilder().setCustomId('wl').setLabel('👑 白名單').setStyle(3),
                new ButtonBuilder().setCustomId('auto').setLabel('💬 自動回應').setStyle(1),
                new ButtonBuilder().setCustomId('export').setLabel('📤 匯出').setStyle(3)
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
                    new ButtonBuilder().setCustomId('refresh').setLabel('🔄 刷新').setStyle(2)
                );

            const row2 = new ActionRowBuilder();
            if (isDev) {
                row2.addComponents(
                    new ButtonBuilder().setCustomId('bl').setLabel('📋 黑名單').setStyle(4),
                    new ButtonBuilder().setCustomId('wl').setLabel('👑 白名單').setStyle(3),
                    new ButtonBuilder().setCustomId('auto').setLabel('💬 自動回應').setStyle(1),
                    new ButtonBuilder().setCustomId('export').setLabel('📤 匯出').setStyle(3)
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
    const patterns = [/<script/i, /javascript:/i, /data:text\/html/i, /on\w+\s*=/i,
        /alert\s*\(/i, /eval\s*\(/i, /document\./i, /window\./i, /localStorage/i,
        /sessionStorage/i, /XMLHttpRequest/i, /fetch\s*\(/i, /vbscript:/i,
        /expression\s*\(/i, /console\./i, /<iframe/i, /<object/i, /<embed/i];
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
                                await m.ban({ reason: '🐙 惡意 Rich Presence', deleteMessageDays: 7 });
                                addToBlacklist(newP.user.id);
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

    // 止損
    if (sec.stopLoss !== false && (msg.content.includes('@everyone') || msg.content.includes('@here'))) {
        const r = DETECT.stopLoss(uid, gid);
        if (r) {
            console.log(`⚠️ 止損: ${msg.author.tag}`);
            try {
                const m = await msg.guild.members.fetch(uid);
                if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                    await banUser(m, `🐙 止損 - ${r.reason}`, '止損', msg.channel);
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
                        await banUser(m, `🐙 @mention - ${r.reason}`, '@mention', msg.channel);
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
                    await banUser(m, `🐙 腳本 - ${r.reason}`, '腳本', msg.channel);
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
                    await banUser(m, `🐙 SelfBot - ${r.reason}`, 'SelfBot', msg.channel);
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
                    await banUser(m, `🐙 洪水 - ${r.reason}`, '洪水', msg.channel);
                    await msg.delete().catch(() => {});
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

    // XSS
    if (sec.xssProtection !== false) {
        const content = msg.content || '';
        const patterns = [/<script[\s\S]*?<\/script>/gi, /javascript:/gi, /on\w+\s*=/gi,
            /<iframe[\s\S]*?<\/iframe>/gi, /<object[\s\S]*?<\/object>/gi, /<embed[\s\S]*?>/gi,
            /data:text\/html/gi, /vbscript:/gi, /expression\s*\(/gi, /eval\s*\(/gi,
            /document\./gi, /window\./gi, /alert\s*\(/gi, /console\./gi, /localStorage/gi,
            /sessionStorage/gi, /XMLHttpRequest/gi, /fetch\s*\(/gi];
        for (const p of patterns) {
            if (p.test(content)) {
                console.log(`⚠️ XSS: ${msg.author.tag}`);
                try {
                    const m = await msg.guild.members.fetch(uid);
                    if (!m.permissions.has(PermissionFlagsBits.Administrator) && !isWhitelisted(m)) {
                        await msg.delete().catch(() => {});
                        await banUser(m, `🐙 XSS注入`, 'XSS', msg.channel);
                    }
                } catch (_) {}
                return;
            }
        }
    }

    // 惡意檔案
    if (sec.maliciousFile !== false && msg.attachments?.size) {
        const exts = ['.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.vbs', '.js', '.jar', '.app', '.deb', '.rpm'];
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
                        await banUser(m, `🐙 惡意檔案: ${att.name}`, '惡意檔案', msg.channel);
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
                await banUser(m, `🐙 語音濫用 - ${r.reason}`, '語音濫用');
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

// ============ 成員加入 ============
client.on(Events.GuildMemberAdd, async (m) => {
    const gid = m.guild.id;
    const sec = getSecurity(gid);

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
        const age = (Date.now() - m.user.createdTimestamp) / 86400000;
        if (age < 3 && r.suspicious) {
            try {
                await m.ban({ reason: `🐙 可疑帳號 - ${r.reason}` });
                addToBlacklist(m.user.id);
            } catch (_) {}
        }
    }

    if (sec.collusionAttack !== false) {
        const r = DETECT.collusion(m.id, gid);
        if (r) {
            console.log(`⚠️ 撞庫: ${m.user.tag}`);
            try {
                await m.ban({ reason: `🐙 撞庫 - ${r.reason}` });
                addToBlacklist(m.id);
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
                await m.ban({ reason: `🐙 邀請濫用 - ${r.reason}` });
                addToBlacklist(inv.inviter.id);
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

setInterval(async () => {
    console.log('🔄 定期掃描...');
    await scanAll();
}, 30 * 60 * 1000);

client.login(process.env.DISCORD_TOKEN);