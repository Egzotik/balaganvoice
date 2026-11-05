import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, ContainerBuilder, SeparatorBuilder, TextDisplayBuilder,
  EmbedBuilder, GatewayIntentBits, MessageFlags, ModalBuilder, AttachmentBuilder,
  PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle
} from 'discord.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  throw new Error('Заполните DISCORD_TOKEN, DISCORD_CLIENT_ID и DISCORD_GUILD_ID в .env');
}
const dataFile = path.resolve(process.env.DATA_FILE || './data/state.json');
const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
fs.mkdirSync(path.dirname(dataFile), { recursive: true });
let state = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : process.env.BOOTSTRAP_STATE_JSON ? JSON.parse(process.env.BOOTSTRAP_STATE_JSON) : { config: {}, rooms: {}, requests: {} };
state.config ||= {}; state.rooms ||= {}; state.requests ||= {};
function save() { const temp = `${dataFile}.tmp`; fs.writeFileSync(temp, JSON.stringify(state, null, 2)); fs.renameSync(temp, dataFile); }
if (!fs.existsSync(dataFile)) save();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const ephemeral = { flags: MessageFlags.Ephemeral };
const field = (id, label, style = TextInputStyle.Short, required = true) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required));
const modal = (id, title, ...fields) => new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...fields);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const rows = (...buttons) => { const out = []; for (let i = 0; i < buttons.length; i += 5) out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5))); return out; };
const roomPanel = room => {
  const row = (...items) => new ActionRowBuilder().addComponents(...items);
  return new ContainerBuilder().setAccentColor(0x2b2d31)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Владелец:\n<@${room.owner}>${room.comment ? `\n\n${room.comment}` : ''}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Управление поиском:**'))
    .addActionRowComponents(row(button('room:post', 'Написать в поиск-пати').setEmoji('🗓️')))
    .addActionRowComponents(row(button('room:comment', 'Добавить/Изменить комментарий').setEmoji('🔄'), button('room:delete_post', 'Удалить сообщение').setEmoji('🗑️')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Управление командой:**'))
    .addActionRowComponents(row(button('room:transfer', 'Передать права').setEmoji('👑'), button('room:kick', 'Выгнать').setEmoji('👤'), button('room:access', 'Вернуть доступ').setEmoji('✔️'), button('room:promote', 'Поднять команду').setEmoji('▶️')))
    .addActionRowComponents(row(button('room:limit', 'Изменить слоты').setEmoji('🗓️'), button('room:name', 'Изменить название').setEmoji('✏️'), button('room:speak', 'Выдать/Забрать право говорить').setEmoji('🔊')))
    .addActionRowComponents(row(button('room:plus', '+1 Слот').setEmoji('✨'), button('room:minus', '−1 Слот').setEmoji('➖'), button('room:hide', 'Скрыть').setEmoji('🔒')));
};
const searchPanel = (room, voice) => {
  const members = [...voice.members.values()].filter(member => !member.user.bot);
  const slots = voice.userLimit || 5;
  const list = Array.from({ length: Math.max(slots, members.length) }, (_, index) => `${index + 1}. ${members[index] ? `<@${members[index].id}>` : '—'}`).join('\n');
  return new ContainerBuilder().setAccentColor(0x2ecc71)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## В поиске | ${voice.name}\n${room.postText ? `${room.postText}\n` : ''}\n${list}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🟢 +${Math.max(0, slots - members.length)}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Присоединиться').setURL(`https://discord.com/channels/${voice.guild.id}/${voice.id}`)));
};
async function refreshSearchPost(guild, room) {
  if (!room?.post) return;
  const voice = guild.channels.cache.get(room.voice);
  const search = guild.channels.cache.get(state.config.search);
  if (!voice || !search) return;
  try {
    if (!room.postV2) {
      await search.messages.delete(room.post).catch(() => {});
      const message = await search.send({ components: [searchPanel(room, voice)], flags: MessageFlags.IsComponentsV2 });
      room.post = message.id; room.postV2 = true; save();
    } else await search.messages.edit(room.post, { components: [searchPanel(room, voice)] });
  }
  catch (error) { if (error.code === 10008) { room.post = null; save(); } else console.error('Не удалось обновить поиск:', error); }
}
const groupEmbed = (request, guild) => {
  const voice = request.voice ? guild.channels.cache.get(request.voice) : null;
  const ids = voice ? [...voice.members.values()].filter(member => !member.user.bot).map(member => member.id) : request.members;
  const embed = new EmbedBuilder().setTitle(`В поиске | ${request.title}`)
    .setDescription(`**Владелец:** <@${request.owner}>\n**Места:** ${ids.length}/${request.places}\n**Участники${voice ? ' войса' : ''}:**\n${ids.length ? ids.map((id, index) => `${index + 1}. <@${id}>`).join('\n') : 'Пока никого нет'}${voice ? `\n\n**Войс:** ${voice}` : ''}`)
    .setColor(0x5865f2);
  return request.banner ? embed.setImage('attachment://robrun-squad.png') : embed;
};
async function refreshGroupPost(guild, messageId, request) {
  const channel = guild.channels.cache.get(state.config.search);
  if (!channel) return;
  try { await channel.messages.edit(messageId, { embeds: [groupEmbed(request, guild)] }); }
  catch (error) { if (error.code === 10008) { delete state.requests[messageId]; save(); } else console.error('Не удалось обновить сбор:', error); }
}
const helpEmbed = () => new EmbedBuilder().setImage('attachment://robrun-help.png').setColor(0x242428);
const helpButtons = () => rows(button('help:question', 'Задать вопрос'), button('help:report', 'Пожаловаться'), button('help:moderator', 'Позвать модератора'));
const commands = [
  new SlashCommandBuilder().setName('настройка').setDescription('Настроить каналы бота')
    .addChannelOption(o => o.setName('категория').setDescription('Категория для голосовых комнат').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addChannelOption(o => o.setName('поиск').setDescription('Канал поиска группы').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName('запросы').setDescription('Канал запросов помощи').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption(o => o.setName('модераторы').setDescription('Роль для вызова помощи').setRequired(true))
    .addChannelOption(o => o.setName('лобби').setDescription('Вход в лобби создаёт комнату автоматически').addChannelTypes(ChannelType.GuildVoice)),
  new SlashCommandBuilder().setName('комната').setDescription('Создать голосовую комнату и панель управления')
    .addStringOption(o => o.setName('название').setDescription('Название комнаты').setRequired(true).setMaxLength(80))
    .addIntegerOption(o => o.setName('слоты').setDescription('Число участников').setMinValue(1).setMaxValue(99)),
  new SlashCommandBuilder().setName('помощь-панель').setDescription('Опубликовать панель помощи'),
  new SlashCommandBuilder().setName('тег').setDescription('Отправить сообщение с упоминанием выбранной роли')
    .addRoleOption(o => o.setName('роль').setDescription('Роль для упоминания').setRequired(true))
    .addStringOption(o => o.setName('сообщение').setDescription('Текст сообщения').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('сбор').setDescription('Объявить набор в группу')
    .addStringOption(o => o.setName('название').setDescription('Название набора').setRequired(true).setMaxLength(100))
    .addIntegerOption(o => o.setName('места').setDescription('Количество мест').setRequired(true).setMinValue(1).setMaxValue(99))
    .addRoleOption(o => o.setName('роль').setDescription('Кого позвать')),
].map(c => c.toJSON());
await new REST({ version: '10' }).setToken(DISCORD_TOKEN).put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });

async function createRoom(guild, member, name, limit = 3) {
  const existing = Object.entries(state.rooms).find(([, r]) => r.owner === member.id && guild.channels.cache.has(r.voice));
  if (existing) return { existing: true, voice: guild.channels.cache.get(existing[1].voice) };
  const voice = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: state.config.category, userLimit: limit, reason: `Комната ${member.user.username}`,
    permissionOverwrites: [{ id: client.user.id, allow: [PermissionFlagsBits.SetVoiceChannelStatus, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });
  try {
    const others = [...guild.channels.cache.values()].filter(channel => channel.parentId === state.config.category && channel.type === ChannelType.GuildVoice && channel.id !== voice.id);
    const bottom = Math.max(0, ...others.map(channel => channel.position)) + 1;
    await voice.setPosition(bottom);
    const room = { owner: member.id, voice: voice.id, chat: voice.id, comment: '', post: null, blocked: [] };
    state.rooms[voice.id] = room; save();
    const panel = await voice.send({ components: [roomPanel(room)], flags: MessageFlags.IsComponentsV2 }); room.panel = panel.id; save();
    return { voice };
  } catch (error) { delete state.rooms[voice.id]; save(); await voice.delete().catch(() => {}); throw error; }
}
async function updateRoomPanel(i, room) { await i.message.edit({ components: [roomPanel(room)], flags: MessageFlags.IsComponentsV2 }); }
function ownedRoom(i) { const room = state.rooms[i.channelId]; if (!room) throw new Error('Эта панель больше не связана с комнатой.'); if (room.owner !== i.user.id) throw new Error('Управлять комнатой может только её владелец.'); return room; }
async function answerError(i, error) { console.error(error); const message = `Ошибка: ${error.message || 'не удалось выполнить действие'}`; if (i.deferred || i.replied) await i.followUp({ content: message, ...ephemeral }); else await i.reply({ content: message, ...ephemeral }); }

client.on('interactionCreate', async i => { try {
  if (!i.inGuild()) return;
  if (i.isChatInputCommand()) {
    await i.deferReply(ephemeral);
    if (['настройка', 'помощь-панель'].includes(i.commandName) && !i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return i.editReply('Для этой команды нужно право «Управлять сервером».');
    }
    if (i.commandName === 'настройка') {
      state.config = { category: i.options.getChannel('категория').id, search: i.options.getChannel('поиск').id, requests: i.options.getChannel('запросы').id, moderators: i.options.getRole('модераторы').id, lobby: i.options.getChannel('лобби')?.id || state.config.lobby || null }; save();
      return i.editReply('Настройки сохранены.');
    }
    if (i.commandName === 'комната') {
      if (!state.config.category) return i.editReply('Администратор должен выполнить /настройка.');
      const result = await createRoom(i.guild, i.member, i.options.getString('название'), i.options.getInteger('слоты') || 3);
      if (!result.existing && i.member.voice?.channelId) await i.member.voice.setChannel(result.voice);
      return i.editReply(result.existing ? `У вас уже есть комната: ${result.voice}.` : `Комната ${result.voice} создана. Панель управления находится в чате самой комнаты.`);
    }
    if (i.commandName === 'помощь-панель') { await i.channel.send({ embeds: [helpEmbed()], files: [new AttachmentBuilder(path.join(assetsDir, 'robrun-help.png'))], components: helpButtons() }); return i.editReply('Панель опубликована.'); }
    if (i.commandName === 'тег') {
      const role = i.options.getRole('роль');
      if (!i.memberPermissions.has(PermissionFlagsBits.MentionEveryone) && !role.mentionable) return i.editReply('Эту роль нельзя упомянуть. Сделайте её упоминаемой или выдайте право «Упоминать @everyone, @here и все роли».');
      await i.channel.send({ content: `<@&${role.id}>`, embeds: [new EmbedBuilder().setTitle('Объявление').setDescription(i.options.getString('сообщение')).setImage('attachment://robrun-announcement.png').setFooter({ text: `Автор: ${i.user.username}` }).setColor(0x5865f2)], files: [new AttachmentBuilder(path.join(assetsDir, 'robrun-announcement.png'))], allowedMentions: { roles: [role.id] } });
      return i.editReply('Сообщение отправлено.');
    }
    if (i.commandName === 'сбор') {
      const channel = i.guild.channels.cache.get(state.config.search); if (!channel) return i.editReply('Сначала настройте канал поиска через /настройка.');
      const role = i.options.getRole('роль'); const places = i.options.getInteger('места');
      const request = { owner: i.user.id, title: i.options.getString('название'), places, voice: i.member.voice?.channelId || null, members: [i.user.id], banner: true };
      const message = await channel.send({ content: role ? `<@&${role.id}>` : '', embeds: [groupEmbed(request, i.guild)], files: [new AttachmentBuilder(path.join(assetsDir, 'robrun-squad.png'))], components: rows(button('join', 'Присоединиться', ButtonStyle.Success), button('leave', 'Выйти', ButtonStyle.Danger)), allowedMentions: { roles: role && (role.mentionable || i.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) ? [role.id] : [] } });
      state.requests[message.id] = request; save();
      return i.editReply(`Набор опубликован: ${message.url}`);
    }
  }
  if (i.isButton()) {
    if (i.customId.startsWith('help:')) return i.showModal(modal(`helpform:${i.customId.slice(5)}`, 'Запрос помощи', field('message', 'Опишите ситуацию', TextInputStyle.Paragraph)));
    if (i.customId === 'join' || i.customId === 'leave') {
      await i.deferReply(ephemeral);
      const req = state.requests[i.message.id]; if (!req) return i.editReply('Набор завершён.');
      const voice = req.voice ? i.guild.channels.cache.get(req.voice) : null;
      if (voice) {
        if (i.customId === 'join') return i.editReply(voice.members.has(i.user.id) ? 'Вы уже в войсе.' : `Присоединитесь к голосовой комнате: ${voice}`);
        if (i.user.id === req.owner) return i.editReply('Владелец не может выйти из группы.');
        if (i.member.voice.channelId === voice.id) await i.member.voice.disconnect();
        return i.editReply('Вы вышли из голосовой комнаты.');
      }
      if (i.customId === 'join') { if (req.members.includes(i.user.id)) return i.editReply('Вы уже в группе.'); if (req.members.length >= req.places) return i.editReply('Мест больше нет.'); req.members.push(i.user.id); }
      else { if (req.owner === i.user.id) return i.editReply('Владелец не может выйти из группы.'); req.members = req.members.filter(id => id !== i.user.id); }
      save(); await refreshGroupPost(i.guild, i.message.id, req); return i.editReply(i.customId === 'join' ? 'Вы вступили в группу.' : 'Вы вышли из группы.');
    }
    if (!i.customId.startsWith('room:')) return;
    const room = ownedRoom(i); const action = i.customId.slice(5); const voice = i.guild.channels.cache.get(room.voice); if (!voice) throw new Error('Голосовая комната удалена.');
    if (['name', 'limit', 'comment', 'post', 'transfer', 'kick', 'access', 'speak'].includes(action)) {
      const prompts = { name: ['Название комнаты', 'Название'], limit: ['Число слотов', 'От 0 до 99'], comment: ['Статус голосового канала', 'Текст статуса'], post: ['Поиск группы', 'Текст объявления'], transfer: ['Передать права', 'ID нового владельца'], kick: ['Выгнать', 'ID участника'], access: ['Вернуть доступ', 'ID участника'], speak: ['Право говорить', 'ID участника'] };
      const [title, label] = prompts[action]; return i.showModal(modal(`roomform:${action}`, title, field('value', label, ['comment', 'post'].includes(action) ? TextInputStyle.Paragraph : TextInputStyle.Short)));
    }
    await i.deferReply(ephemeral);
    if (action === 'delete_post') { if (room.post) await i.guild.channels.cache.get(state.config.search)?.messages.delete(room.post).catch(() => {}); room.post = null; save(); return i.editReply('Сообщение поиска удалено.'); }
    if (action === 'promote') { const lobby = i.guild.channels.cache.get(state.config.lobby); if (!lobby) throw new Error('Входной войс не настроен.'); await voice.setPosition(lobby.position + 1); return i.editReply('Комната поднята под входным войсом, ниже постоянных каналов.'); }
    if (action === 'plus' || action === 'minus') { await voice.setUserLimit(Math.max(0, Math.min(99, voice.userLimit + (action === 'plus' ? 1 : -1)))); await refreshSearchPost(i.guild, room); return i.editReply(`Лимит: ${voice.userLimit || 'без ограничений'}.`); }
    if (action === 'hide') { const hidden = !voice.permissionOverwrites.cache.get(i.guild.id)?.deny.has(PermissionFlagsBits.ViewChannel); await voice.permissionOverwrites.edit(i.guild.id, { ViewChannel: hidden ? false : null }); return i.editReply(hidden ? 'Комната скрыта.' : 'Комната видна.'); }
  }
  if (i.isModalSubmit()) {
    await i.deferReply(ephemeral);
    const value = i.fields.getTextInputValue(i.customId.startsWith('helpform:') ? 'message' : 'value').trim();
    if (!value) return i.editReply('Введите текст.');
    if (i.customId.startsWith('helpform:')) {
      const channel = i.guild.channels.cache.get(state.config.requests); if (!channel) return i.editReply('Канал запросов не настроен.');
      const kinds = { question: 'Вопрос', report: 'Жалоба', moderator: 'Вызов модератора' }; const kind = kinds[i.customId.slice(9)] || 'Запрос';
      await channel.send({ content: state.config.moderators ? `<@&${state.config.moderators}>` : '', embeds: [new EmbedBuilder().setTitle(kind).setDescription(value).addFields({ name: 'Автор', value: `<@${i.user.id}>` }).setColor(0x2ecc71)], allowedMentions: { roles: state.config.moderators ? [state.config.moderators] : [] } });
      return i.editReply('Запрос отправлен.');
    }
    if (!i.customId.startsWith('roomform:')) return;
    const room = ownedRoom(i); const action = i.customId.slice(9); const voice = i.guild.channels.cache.get(room.voice);
    if (!voice) throw new Error('Голосовая комната удалена.');
    if (action === 'name') await voice.setName(value.slice(0, 80));
    else if (action === 'limit') { const limit = Number(value); if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new Error('Укажите число от 0 до 99.'); await voice.setUserLimit(limit); }
    else if (action === 'comment') {
      const status = value.slice(0, 500);
      await voice.permissionOverwrites.edit(client.user.id, { SetVoiceChannelStatus: true, ManageChannels: true });
      await client.rest.put(Routes.channelVoiceStatus(voice.id), { body: { status } });
      room.comment = status;
      await updateRoomPanel(i, room);
    }
    else if (action === 'post') { const channel = i.guild.channels.cache.get(state.config.search); if (!channel) throw new Error('Канал поиска не настроен.'); if (room.post) await channel.messages.delete(room.post).catch(() => {}); room.postText = value.slice(0, 1500); const m = await channel.send({ components: [searchPanel(room, voice)], flags: MessageFlags.IsComponentsV2 }); room.post = m.id; room.postV2 = true; }
    else {
      const id = value.match(/\d{17,20}/)?.[0]; if (!id) throw new Error('Укажите ID участника (17–20 цифр).');
      if (action === 'transfer') { const member = await i.guild.members.fetch(id); if (!voice.members.has(id)) throw new Error('Новый владелец должен находиться в комнате.'); room.owner = member.id; await i.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true }); await updateRoomPanel(i, room); await refreshSearchPost(i.guild, room); }
      if (action === 'kick') { if (id === room.owner) throw new Error('Нельзя выгнать владельца.'); const member = await i.guild.members.fetch(id); if (member.voice.channelId === voice.id) await member.voice.disconnect(); await voice.permissionOverwrites.edit(id, { Connect: false }); room.blocked = [...new Set([...room.blocked, id])]; }
      if (action === 'access') { await voice.permissionOverwrites.edit(id, { Connect: null }); room.blocked = room.blocked.filter(x => x !== id); }
      if (action === 'speak') { const current = voice.permissionOverwrites.cache.get(id)?.allow.has(PermissionFlagsBits.Speak); await voice.permissionOverwrites.edit(id, { Speak: !current }); }
    }
    save(); if (action === 'name' || action === 'limit') await refreshSearchPost(i.guild, room); return i.editReply('Готово.');
  }
} catch (error) { await answerError(i, error).catch(console.error); } });
client.on('error', error => console.error('Ошибка Discord:', error));

client.on('voiceStateUpdate', async (before, after) => { try {
  if (after.channelId && after.channelId === state.config.lobby && before.channelId !== after.channelId && !after.member.user.bot) {
    const result = await createRoom(after.guild, after.member, `Комната ${after.member.user.username}`, 3);
    await after.member.voice.setChannel(result.voice);
  }
  if (before.channelId && before.channelId !== after.channelId) {
    const entry = Object.entries(state.rooms).find(([, r]) => r.voice === before.channelId);
    if (entry && before.channel?.members.size === 0) { const [roomId, room] = entry; if (room.post) await before.guild.channels.cache.get(state.config.search)?.messages.delete(room.post).catch(() => {}); delete state.rooms[roomId]; save(); if (room.chat !== room.voice) await before.guild.channels.cache.get(room.chat)?.delete().catch(console.error); await before.guild.channels.cache.get(room.voice)?.delete().catch(console.error); }
  }
  if (before.channelId !== after.channelId) {
    const affected = new Set([before.channelId, after.channelId]);
    for (const room of Object.values(state.rooms)) if (affected.has(room.voice)) await refreshSearchPost(after.guild, room);
    for (const [messageId, request] of Object.entries(state.requests)) if (request.voice && affected.has(request.voice)) await refreshGroupPost(after.guild, messageId, request);
  }
} catch (error) { console.error('Ошибка голосового события:', error); } });
client.once('clientReady', async () => {
  console.log(`Бот запущен: ${client.user.tag}`);
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
  if (guild) {
    const fullGuild = client.guilds.cache.get(guild.id);
    if (state.config.category && (!state.config.lobby || !fullGuild.channels.cache.has(state.config.lobby))) {
      try {
        const lobby = await fullGuild.channels.create({ name: '➕ Создать комнату', type: ChannelType.GuildVoice, parent: state.config.category, reason: 'Вход для временных голосовых комнат' });
        state.config.lobby = lobby.id; save();
        console.log(`Входной голосовой канал создан: ${lobby.id}`);
      } catch (error) { console.error('Не удалось создать входной голосовой канал:', error); }
    }
    const lobby = fullGuild.channels.cache.get(state.config.lobby);
    if (lobby) {
      const categoryVoices = [...fullGuild.channels.cache.values()].filter(channel =>
        channel.parentId === state.config.category &&
        [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type));
      const permanentVoices = categoryVoices.filter(channel => channel.id !== lobby.id && !Object.values(state.rooms).some(room => room.voice === channel.id)).sort((a, b) => a.position - b.position);
      const temporaryVoices = categoryVoices.filter(channel => Object.values(state.rooms).some(room => room.voice === channel.id)).sort((a, b) => a.position - b.position);
      const ordered = [...permanentVoices, lobby, ...temporaryVoices];
      if (ordered.some((channel, index) => channel.position !== index)) {
        await fullGuild.channels.setPositions(ordered.map((channel, position) => ({ channel, position }))).catch(console.error);
      }
    }
    for (const room of Object.values(state.rooms)) await refreshSearchPost(fullGuild, room);
    for (const [messageId, request] of Object.entries(state.requests)) await refreshGroupPost(fullGuild, messageId, request);
  }
  for (const [id, room] of Object.entries(state.rooms)) {
    try {
      const voice = await client.channels.fetch(room.voice);
      if (!voice) continue;
      if (!room.panel) {
        const recent = await voice.messages.fetch({ limit: 30 });
        for (const message of recent.values()) if (message.author.id === client.user.id && message.components.some(component => JSON.stringify(component.toJSON()).includes('room:'))) await message.delete().catch(() => {});
        const panel = await voice.send({ components: [roomPanel(room)], flags: MessageFlags.IsComponentsV2 }); room.panel = panel.id;
      } else {
        try { await voice.messages.edit(room.panel, { components: [roomPanel(room)] }); }
        catch (error) {
          if (error.code !== 10008) throw error;
          const panel = await voice.send({ components: [roomPanel(room)], flags: MessageFlags.IsComponentsV2 }); room.panel = panel.id;
        }
      }
      if (room.chat !== room.voice) {
        room.chat = room.voice;
        state.rooms[room.voice] = room;
        delete state.rooms[id];
        await client.channels.fetch(id).then(channel => channel?.delete()).catch(console.error);
      }
      save();
    } catch (error) {
      if (error.code === 10003) { delete state.rooms[id]; save(); }
      else console.error('Не удалось перенести панель комнаты:', error);
    }
  }
});
await client.login(DISCORD_TOKEN);
