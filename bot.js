require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

const BLACKLIST_FILE = './blacklist.json';
const CONFIG_FILE = './config.json';
const LOG_FILE = './logs.json';

// ============ 黑名單 ============
function loadBlacklist() {
    try {
        if (fs.existsSync(BLACKLIST_FILE)) {
            const data = fs.readFileSync(BLACKLIST_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('讀取黑名單失敗:', error);
    }
    return { bannedUsers: [] };
}

function saveBlacklist(blacklist) {
    try {
        fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(blacklist, null, 2));
        console.log('✅ 黑名單已儲存');
    } catch (error) {
        console.error('儲存黑名單失敗:', error);
    }
}

function addToBlacklist(userId) {
    const blacklist = loadBlacklist();
    if (!blacklist.bannedUsers.includes(userId)) {
        blacklist.bannedUsers.push(userId);
        saveBlacklist(blacklist);
        return true;
    }
    return false;
}

// ============ Config 儲存（純陣列版） ============
// 儲存結構：{ "guildId": ["channelId1", "channelId2"] }
const monitoredChannels = {}; // 改用物件，不用 Map

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ monitoredChannels: monitoredChannels }, null, 2));
        console.log('✅ 設定已儲存');
    } catch (error) {
        console.error('儲存設定失敗:', error);
    }
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.monitoredChannels) {
                return parsed.monitoredChannels;
            }
        }
    } catch (error) {
        console.error('讀取設定檔失敗:', error);
    }
    return {};
}

// ============ 日誌 ============
function logAction(action, details) {
    try {
        let logs = [];
        if (fs.existsSync(LOG_FILE)) {
            const data = fs.readFileSync(LOG_FILE, 'utf8');
            logs = JSON.parse(data);
        }
        logs.push({
            timestamp: new Date().toISOString(),
            action: action,
            details: details
        });
        if (logs.length > 1000) {
            logs = logs.slice(-1000);
        }
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error('寫入日誌失敗:', error);
    }
}

// ============ 統一 Ban 函數 ============
async function banUser(member, reason, logReason, channel = null) {
    const userId = member.id;
    const userTag = member.user.tag;
    const guild = member.guild;

    try {
        await member.ban({
            reason: reason,
            deleteMessageDays: 7
        });

        if (addToBlacklist(userId)) {
            console.log(`📋 已加入黑名單: ${userTag} (${userId})`);
        }

        logAction('BAN', {
            userId: userId,
            userTag: userTag,
            guildId: guild.id,
            guildName: guild.name,
            channelId: channel ? channel.id : null,
            reason: logReason
        });

        console.log(`🔨 已 Ban ${userTag} (${userId})`);

        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('🔨 防傳銷觸發')
                .setDescription(`**${userTag}** 已被 Ban 並加入全域黑名單`)
                .addFields(
                    { name: '原因', value: logReason, inline: true },
                    { name: '黑名單', value: `已記錄 (${loadBlacklist().bannedUsers.length} 人)`, inline: true },
                    { name: '時間', value: new Date().toLocaleString(), inline: true }
                );
            await channel.send({ embeds: [embed] });
        }

        return true;
    } catch (error) {
        console.error(`Ban 失敗 (${userTag}):`, error.message);
        return false;
    }
}

// ============ 止損機制 ============
const mentionTracker = new Map();

function checkMentionSpam(userId, channelId, guildId) {
    const now = Date.now();
    const window = 1000;
    
    if (!mentionTracker.has(userId)) {
        mentionTracker.set(userId, []);
    }
    
    const history = mentionTracker.get(userId);
    const recent = history.filter(entry => now - entry.timestamp < window);
    recent.push({ timestamp: now, channelId, guildId });
    
    mentionTracker.set(userId, recent);
    
    const uniqueChannels = new Set(recent.map(entry => `${entry.guildId}_${entry.channelId}`));
    
    if (uniqueChannels.size >= 2) {
        return true;
    }
    
    return false;
}

// ============ 分頁紀錄 ============
const userPage = new Map();

// ============ 機器人啟動 ============
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ 已登入為 ${readyClient.user.tag}`);
    console.log(`📋 黑名單數量: ${loadBlacklist().bannedUsers.length} 人`);
    
    // 載入設定
    const loaded = loadConfig();
    console.log('📂 從 config.json 讀取到的內容:', JSON.stringify(loaded, null, 2));
    
    // 合併到 monitoredChannels
    for (const [guildId, channelIds] of Object.entries(loaded)) {
        if (Array.isArray(channelIds) && channelIds.length > 0) {
            monitoredChannels[guildId] = channelIds;
            console.log(`✅ 載入 ${channelIds.length} 個頻道 (伺服器 ${guildId})`);
        }
    }
    
    const total = getTotalMonitored();
    console.log(`📂 總共載入 ${total} 個受保護頻道`);
    
    try {
        const commands = await client.application.commands.fetch();
        for (const [id, cmd] of commands) {
            await client.application.commands.delete(id);
        }
    } catch (error) {}
    
    console.log(`🤖 監控 ${total} 個頻道`);
    console.log('📡 輸入 !章魚 開啟控制面板');
    
    await scanAllServers();
    await scanProtectedChannels();
});

// ============ 掃描所有伺服器 ============
async function scanAllServers() {
    const blacklist = loadBlacklist();
    if (blacklist.bannedUsers.length === 0) {
        console.log('📋 黑名單為空，跳過掃描');
        return;
    }

    console.log(`🔍 開始掃描 ${client.guilds.cache.size} 個伺服器...`);
    let totalBanned = 0;

    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const members = await guild.members.fetch();
            let found = 0;

            for (const userId of blacklist.bannedUsers) {
                const member = members.get(userId);
                if (member && !member.user.bot) {
                    const success = await banUser(
                        member,
                        '🐙 全域黑名單 - 曾在其他伺服器觸發防傳銷',
                        '全域黑名單掃描'
                    );
                    if (success) {
                        found++;
                        totalBanned++;
                    }
                }
            }

            if (found > 0) {
                console.log(`✅ ${guild.name}: 封鎖 ${found} 人`);
            }
        } catch (error) {
            console.log(`⚠️ 無法掃描 ${guild.name}: ${error.message}`);
        }
    }

    console.log(`✅ 全域掃描完成，共封鎖 ${totalBanned} 人`);
}

// ============ 掃描受保護頻道 ============
async function scanProtectedChannels() {
    const blacklist = loadBlacklist();
    if (blacklist.bannedUsers.length === 0) {
        console.log('📋 黑名單為空，跳過保護頻道掃描');
        return;
    }

    console.log(`🔍 開始掃描受保護頻道...`);
    let totalBanned = 0;

    for (const [guildId, channelIds] of Object.entries(monitoredChannels)) {
        if (channelIds.length === 0) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.log(`⚠️ 找不到伺服器: ${guildId}`);
            continue;
        }

        try {
            const members = await guild.members.fetch();
            let found = 0;

            for (const userId of blacklist.bannedUsers) {
                const member = members.get(userId);
                if (!member || member.user.bot) continue;

                for (const channelId of channelIds) {
                    const channel = guild.channels.cache.get(channelId);
                    if (!channel) continue;

                    const perms = channel.permissionsFor(member);
                    if (perms && perms.has(PermissionFlagsBits.ViewChannel)) {
                        const success = await banUser(
                            member,
                            '🐙 黑名單掃描 - 位於受保護頻道中',
                            '黑名單掃描 - 位於受保護頻道中',
                            channel
                        );
                        if (success) {
                            found++;
                            totalBanned++;
                        }
                        break;
                    }
                }
            }

            if (found > 0) {
                console.log(`✅ ${guild.name}: 保護頻道掃描封鎖 ${found} 人`);
            }
        } catch (error) {
            console.log(`⚠️ 無法掃描 ${guild.name}: ${error.message}`);
        }
    }

    console.log(`✅ 保護頻道掃描完成，共封鎖 ${totalBanned} 人`);
}

// ============ !章魚 指令 ============
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.trim() !== '!章魚') return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ 需要管理員權限！');
    }
    userPage.set(message.author.id, 0);
    await showPanel(message, 0);
});

// ============ 顯示面板 ============
async function showPanel(message, page = 0) {
    const guildId = message.guildId;
    if (!monitoredChannels[guildId]) {
        monitoredChannels[guildId] = [];
    }

    const channels = monitoredChannels[guildId];
    const guild = message.guild;
    const blacklist = loadBlacklist();

    const textChannels = guild.channels.cache
        .filter(ch => ch.isTextBased() && ch.viewable)
        .map(ch => ({ id: ch.id, name: ch.name || '無名稱' }));

    const total = textChannels.length;
    const perPage = 25;
    const totalPages = Math.ceil(total / perPage) || 1;
    const start = page * perPage;
    const end = Math.min(start + perPage, total);
    const pageChannels = textChannels.slice(start, end);

    const options = pageChannels.map(ch => {
        const isProtected = channels.includes(ch.id);
        return {
            label: ch.name.slice(0, 25),
            value: ch.id,
            description: isProtected ? '已保護 ✅' : '未保護 ❌',
            emoji: isProtected ? '🔒' : '🔓'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_channel')
        .setPlaceholder(`📂 第 ${page + 1}/${totalPages} 頁 (${channels.length}/${total} 已保護)`)
        .addOptions(options);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    const row2 = new ActionRowBuilder();
    if (totalPages > 1) {
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId('prev_page')
                .setLabel('◀ 上一頁')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('next_page')
                .setLabel('下一頁 ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
    }
    row2.addComponents(
        new ButtonBuilder()
            .setCustomId('refresh_panel')
            .setLabel('🔄 刷新')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('show_blacklist')
            .setLabel('📋 黑名單')
            .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🐙 防傳銷控制面板')
        .setDescription(`第 ${page + 1}/${totalPages} 頁 • 從下拉選單選擇頻道`)
        .addFields(
            { name: '📊 受保護', value: `${channels.length} 個`, inline: true },
            { name: '📊 總頻道', value: `${total} 個`, inline: true },
            { name: '📋 黑名單', value: `${blacklist.bannedUsers.length} 人`, inline: true },
            { 
                name: '📋 保護清單', 
                value: channels.length > 0 ? 
                    channels.slice(0, 15).map(id => {
                        const ch = guild.channels.cache.get(id);
                        return ch ? `🔒 <#${id}>` : '🔒 已刪除';
                    }).join('\n') + (channels.length > 15 ? `\n... 還有 ${channels.length - 15} 個` : '') : 
                    '⚠️ 無',
                inline: false 
            }
        )
        .setFooter({ text: `管理員專用 • ${guild.name}` })
        .setTimestamp();

    await message.reply({
        embeds: [embed],
        components: [row1, row2]
    });
}

// ============ 互動處理 ============
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ 需要管理員權限！', flags: 64 });
    }

    const guildId = interaction.guildId;
    if (!monitoredChannels[guildId]) {
        monitoredChannels[guildId] = [];
    }

    const channels = monitoredChannels[guildId];
    const userId = interaction.user.id;
    const currentPage = userPage.get(userId) || 0;

    try {
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_channel') {
            const channelId = interaction.values[0];
            const channel = interaction.guild.channels.cache.get(channelId);

            if (!channel) {
                return interaction.reply({ content: '❌ 找不到頻道', flags: 64 });
            }

            const bot = await interaction.guild.members.fetch(client.user.id);
            if (!channel.permissionsFor(bot).has(PermissionFlagsBits.BanMembers)) {
                return interaction.reply({ content: `❌ 沒有 Ban 權限！`, flags: 64 });
            }

            const index = channels.indexOf(channelId);
            if (index !== -1) {
                channels.splice(index, 1);
                await interaction.reply({ content: `🔓 已解除 <#${channelId}> 保護`, flags: 64 });
            } else {
                channels.push(channelId);
                await interaction.reply({ content: `🛡️ 已啟動 <#${channelId}> 保護！`, flags: 64 });
                try {
                    await channel.send({
                        content: `⚠️ **此頻道已啟動防傳銷保護！**\n任何人在此頻道發送訊息將會被 **Ban** 並加入全域黑名單。\n管理員請謹慎操作，誤 Ban 風險自負。`
                    });
                } catch (e) {}
            }
            
            saveConfig();
            console.log(`📝 目前保護頻道: ${channels.join(', ')}`);
            await updatePanel(interaction, currentPage);

        } else if (interaction.isButton() && interaction.customId === 'prev_page') {
            const newPage = Math.max(0, currentPage - 1);
            userPage.set(userId, newPage);
            await updatePanel(interaction, newPage);
            await interaction.reply({ content: `📄 第 ${newPage + 1} 頁`, flags: 64 });

        } else if (interaction.isButton() && interaction.customId === 'next_page') {
            const textChannels = interaction.guild.channels.cache
                .filter(ch => ch.isTextBased() && ch.viewable);
            const totalPages = Math.ceil(textChannels.size / 25) || 1;
            const newPage = Math.min(totalPages - 1, currentPage + 1);
            userPage.set(userId, newPage);
            await updatePanel(interaction, newPage);
            await interaction.reply({ content: `📄 第 ${newPage + 1} 頁`, flags: 64 });

        } else if (interaction.isButton() && interaction.customId === 'refresh_panel') {
            await updatePanel(interaction, currentPage);
            await interaction.reply({ content: '🔄 已刷新', flags: 64 });

        } else if (interaction.isButton() && interaction.customId === 'show_blacklist') {
            const blacklist = loadBlacklist();
            
            if (blacklist.bannedUsers.length === 0) {
                return interaction.reply({
                    content: '📋 黑名單為空',
                    flags: 64
                });
            }

            let userList = '';
            let count = 0;
            for (const id of blacklist.bannedUsers) {
                try {
                    const user = await client.users.fetch(id);
                    userList += `${count + 1}. ${user.tag} (${id})\n`;
                } catch {
                    userList += `${count + 1}. 未知使用者 (${id})\n`;
                }
                count++;
                if (count >= 20) {
                    userList += `\n... 還有 ${blacklist.bannedUsers.length - 20} 人`;
                    break;
                }
            }

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('📋 全域黑名單')
                .setDescription(`共 ${blacklist.bannedUsers.length} 人`)
                .addFields(
                    { name: '名單', value: userList || '無', inline: false }
                )
                .setFooter({ text: '這些帳號在所有伺服器都會被自動 Ban' })
                .setTimestamp();

            await interaction.reply({
                embeds: [embed],
                flags: 64
            });
        }

    } catch (error) {
        console.error('錯誤:', error);
        try {
            await interaction.reply({ content: '❌ 操作失敗', flags: 64 });
        } catch (e) {}
    }
});

// ============ 更新面板 ============
async function updatePanel(interaction, page = 0) {
    const guildId = interaction.guildId;
    const channels = monitoredChannels[guildId] || [];
    const guild = interaction.guild;
    const blacklist = loadBlacklist();

    const textChannels = guild.channels.cache
        .filter(ch => ch.isTextBased() && ch.viewable)
        .map(ch => ({ id: ch.id, name: ch.name || '無名稱' }));

    const total = textChannels.length;
    const perPage = 25;
    const totalPages = Math.ceil(total / perPage) || 1;
    const start = page * perPage;
    const end = Math.min(start + perPage, total);
    const pageChannels = textChannels.slice(start, end);

    const options = pageChannels.map(ch => {
        const isProtected = channels.includes(ch.id);
        return {
            label: ch.name.slice(0, 25),
            value: ch.id,
            description: isProtected ? '已保護 ✅' : '未保護 ❌',
            emoji: isProtected ? '🔒' : '🔓'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_channel')
        .setPlaceholder(`📂 第 ${page + 1}/${totalPages} 頁 (${channels.length}/${total} 已保護)`)
        .addOptions(options);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    const row2 = new ActionRowBuilder();
    if (totalPages > 1) {
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId('prev_page')
                .setLabel('◀ 上一頁')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('next_page')
                .setLabel('下一頁 ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
    }
    row2.addComponents(
        new ButtonBuilder()
            .setCustomId('refresh_panel')
            .setLabel('🔄 刷新')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('show_blacklist')
            .setLabel('📋 黑名單')
            .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🐙 防傳銷控制面板')
        .setDescription(`第 ${page + 1}/${totalPages} 頁 • 從下拉選單選擇頻道`)
        .addFields(
            { name: '📊 受保護', value: `${channels.length} 個`, inline: true },
            { name: '📊 總頻道', value: `${total} 個`, inline: true },
            { name: '📋 黑名單', value: `${blacklist.bannedUsers.length} 人`, inline: true },
            { 
                name: '📋 保護清單', 
                value: channels.length > 0 ? 
                    channels.slice(0, 15).map(id => {
                        const ch = guild.channels.cache.get(id);
                        return ch ? `🔒 <#${id}>` : '🔒 已刪除';
                    }).join('\n') + (channels.length > 15 ? `\n... 還有 ${channels.length - 15} 個` : '') : 
                    '⚠️ 無',
                inline: false 
            }
        )
        .setFooter({ text: `管理員專用 • ${guild.name}` })
        .setTimestamp();

    await interaction.message.edit({
        embeds: [embed],
        components: [row1, row2]
    });
}

// ============ 防傳銷核心 ============
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    
    const guildId = message.guildId;
    if (!guildId) return;
    
    const content = message.content || '';
    const hasMention = content.includes('@everyone') || content.includes('@here');
    
    if (hasMention) {
        const userId = message.author.id;
        const channelId = message.channelId;
        
        if (checkMentionSpam(userId, channelId, guildId)) {
            console.log(`⚠️ 止損觸發: ${message.author.tag} 在 1 秒內 @everyone/@here 兩個頻道`);
            
            try {
                const member = await message.guild.members.fetch(userId);
                if (member.permissions.has(PermissionFlagsBits.Administrator)) {
                    console.log(`⏭️ 跳過管理員: ${message.author.tag}`);
                    return;
                }
                
                const success = await banUser(
                    member,
                    '🐙 止損機制 - 1秒內在兩個頻道 @everyone/@here',
                    '1秒內在兩個頻道 @everyone/@here',
                    message.channel
                );
                if (success) {
                    try {
                        await message.delete();
                    } catch (e) {}
                }
                
            } catch (error) {
                console.error('止損 Ban 失敗:', error);
            }
            
            return;
        }
    }
    
    const channels = monitoredChannels[guildId] || [];
    if (!channels.includes(message.channelId)) return;

    try {
        const member = await message.guild.members.fetch(message.author.id);
        if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

        await banUser(
            member,
            '🐙 防傳銷機制 - 已加入全域黑名單',
            '在受保護頻道發送訊息',
            message.channel
        );

    } catch (error) {
        console.error('Ban 失敗:', error);
    }
});

// ============ 定期掃描 ============
setInterval(async () => {
    console.log('🔄 定期掃描黑名單...');
    await scanAllServers();
    await scanProtectedChannels();
}, 30 * 60 * 1000);

// ============ 輔助函數 ============
function getTotalMonitored() {
    let total = 0;
    for (const [key, value] of Object.entries(monitoredChannels)) {
        total += value.length;
    }
    return total;
}

client.login(process.env.DISCORD_TOKEN);