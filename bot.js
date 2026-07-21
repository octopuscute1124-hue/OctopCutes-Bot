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

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('讀取設定檔失敗:', error);
    }
    return { monitoredChannels: {} };
}

function saveConfig() {
    try {
        const data = {
            monitoredChannels: Object.fromEntries(monitoredChannels)
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
        console.log('✅ 設定已儲存');
    } catch (error) {
        console.error('儲存設定失敗:', error);
    }
}

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

const monitoredChannels = new Map();
const userPage = new Map();

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ 已登入為 ${readyClient.user.tag}`);
    console.log(`📋 黑名單數量: ${loadBlacklist().bannedUsers.length} 人`);
    
    const config = loadConfig();
    for (const [guildId, channelIds] of Object.entries(config.monitoredChannels || {})) {
        if (Array.isArray(channelIds)) {
            monitoredChannels.set(guildId, new Set(channelIds));
        } else {
            monitoredChannels.set(guildId, new Set());
        }
    }
    console.log(`📂 載入 ${getTotalMonitored()} 個受保護頻道`);
    
    try {
        const commands = await client.application.commands.fetch();
        for (const [id, cmd] of commands) {
            await client.application.commands.delete(id);
        }
    } catch (error) {}
    
    console.log(`🤖 監控 ${getTotalMonitored()} 個頻道`);
    console.log('📡 輸入 !章魚 開啟控制面板');
    
    await scanAllServers();
    await scanProtectedChannels();
});

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
                    try {
                        await member.ban({
                            reason: '🐙 全域黑名單 - 曾在其他伺服器觸發防傳銷',
                            deleteMessageDays: 7
                        });
                        found++;
                        totalBanned++;
                        console.log(`🔨 全域封鎖: ${member.user.tag} (${userId}) 在 ${guild.name}`);
                    } catch (err) {
                        console.log(`⚠️ 無法 Ban ${userId} 在 ${guild.name}: ${err.message}`);
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

async function scanProtectedChannels() {
    const blacklist = loadBlacklist();
    if (blacklist.bannedUsers.length === 0) {
        console.log('📋 黑名單為空，跳過保護頻道掃描');
        return;
    }

    console.log(`🔍 開始掃描受保護頻道...`);
    let totalBanned = 0;

    for (const [guildId, channelIds] of monitoredChannels) {
        if (channelIds.size === 0) continue;

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
                        try {
                            await member.ban({
                                reason: '🐙 黑名單掃描 - 位於受保護頻道中',
                                deleteMessageDays: 7
                            });
                            found++;
                            totalBanned++;
                            console.log(`🔨 保護頻道掃描封鎖: ${member.user.tag} (${userId}) 在 ${guild.name} / #${channel.name}`);
                        } catch (err) {
                            console.log(`⚠️ 無法 Ban ${userId} 在 ${guild.name}: ${err.message}`);
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

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.trim() !== '!章魚') return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ 需要管理員權限！');
    }
    userPage.set(message.author.id, 0);
    await showPanel(message, 0);
});

async function showPanel(message, page = 0) {
    const guildId = message.guildId;
    if (!monitoredChannels.has(guildId)) {
        monitoredChannels.set(guildId, new Set());
    }

    const channels = monitoredChannels.get(guildId);
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
        const isProtected = channels.has(ch.id);
        return {
            label: ch.name.slice(0, 25),
            value: ch.id,
            description: isProtected ? '已保護 ✅' : '未保護 ❌',
            emoji: isProtected ? '🔒' : '🔓'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_channel')
        .setPlaceholder(`📂 第 ${page + 1}/${totalPages} 頁 (${channels.size}/${total} 已保護)`)
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
            { name: '📊 受保護', value: `${channels.size} 個`, inline: true },
            { name: '📊 總頻道', value: `${total} 個`, inline: true },
            { name: '📋 黑名單', value: `${blacklist.bannedUsers.length} 人`, inline: true },
            { 
                name: '📋 保護清單', 
                value: channels.size > 0 ? 
                    [...channels].slice(0, 15).map(id => {
                        const ch = guild.channels.cache.get(id);
                        return ch ? `🔒 <#${id}>` : '🔒 已刪除';
                    }).join('\n') + (channels.size > 15 ? `\n... 還有 ${channels.size - 15} 個` : '') : 
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

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ 需要管理員權限！', flags: 64 });
    }

    const guildId = interaction.guildId;
    if (!monitoredChannels.has(guildId)) {
        monitoredChannels.set(guildId, new Set());
    }

    const channels = monitoredChannels.get(guildId);
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

            if (channels.has(channelId)) {
                channels.delete(channelId);
                await interaction.reply({ content: `🔓 已解除 <#${channelId}> 保護`, flags: 64 });
            } else {
                channels.add(channelId);
                await interaction.reply({ content: `🛡️ 已啟動 <#${channelId}> 保護！`, flags: 64 });
            }
            saveConfig();
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
        } catch (e) {
            console.error('回應失敗:', e);
        }
    }
});

async function updatePanel(interaction, page = 0) {
    const guildId = interaction.guildId;
    const channels = monitoredChannels.get(guildId) || new Set();
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
        const isProtected = channels.has(ch.id);
        return {
            label: ch.name.slice(0, 25),
            value: ch.id,
            description: isProtected ? '已保護 ✅' : '未保護 ❌',
            emoji: isProtected ? '🔒' : '🔓'
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_channel')
        .setPlaceholder(`📂 第 ${page + 1}/${totalPages} 頁 (${channels.size}/${total} 已保護)`)
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
            { name: '📊 受保護', value: `${channels.size} 個`, inline: true },
            { name: '📊 總頻道', value: `${total} 個`, inline: true },
            { name: '📋 黑名單', value: `${blacklist.bannedUsers.length} 人`, inline: true },
            { 
                name: '📋 保護清單', 
                value: channels.size > 0 ? 
                    [...channels].slice(0, 15).map(id => {
                        const ch = guild.channels.cache.get(id);
                        return ch ? `🔒 <#${id}>` : '🔒 已刪除';
                    }).join('\n') + (channels.size > 15 ? `\n... 還有 ${channels.size - 15} 個` : '') : 
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
                
                await member.ban({
                    reason: '🐙 止損機制 - 1秒內在兩個頻道 @everyone/@here',
                    deleteMessageDays: 7
                });
                
                if (addToBlacklist(userId)) {
                    console.log(`📋 已加入黑名單: ${message.author.tag} (${userId})`);
                }
                
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('🔨 止損機制觸發')
                    .setDescription(`**${message.author.tag}** 已被 Ban 並加入全域黑名單`)
                    .addFields(
                        { name: '原因', value: '1秒內在兩個頻道 @everyone/@here', inline: true },
                        { name: '黑名單', value: `已記錄 (${loadBlacklist().bannedUsers.length} 人)`, inline: true },
                        { name: '時間', value: new Date().toLocaleString(), inline: true }
                    );
                await message.channel.send({ embeds: [embed] });
                
                try {
                    await message.delete();
                } catch (e) {}
                
            } catch (error) {
                console.error('止損 Ban 失敗:', error);
            }
            
            return;
        }
    }
    
    const channels = monitoredChannels.get(guildId);
    if (!channels) return;
    if (!channels.has(message.channelId)) return;

    try {
        const member = await message.guild.members.fetch(message.author.id);
        if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

        await member.ban({
            reason: '🐙 防傳銷機制 - 已加入全域黑名單',
            deleteMessageDays: 7
        });

        const userId = message.author.id;
        if (addToBlacklist(userId)) {
            console.log(`📋 已加入黑名單: ${message.author.tag} (${userId})`);
        }

        console.log(`🔨 已 Ban ${message.author.tag} (${userId})`);
        
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('🔨 防傳銷觸發')
            .setDescription(`**${message.author.tag}** 已被 Ban 並加入全域黑名單`)
            .addFields(
                { name: '原因', value: '在受保護頻道發送訊息', inline: true },
                { name: '黑名單', value: `已記錄 (${loadBlacklist().bannedUsers.length} 人)`, inline: true },
                { name: '時間', value: new Date().toLocaleString(), inline: true }
            );
        await message.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Ban 失敗:', error);
    }
});

setInterval(async () => {
    console.log('🔄 定期掃描黑名單...');
    await scanAllServers();
    await scanProtectedChannels();
}, 30 * 60 * 1000);

function getTotalMonitored() {
    let total = 0;
    for (const [key, value] of monitoredChannels) {
        total += value.size;
    }
    return total;
}

client.login(process.env.DISCORD_TOKEN);