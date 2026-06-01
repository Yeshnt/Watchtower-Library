const {
  Client, GatewayIntentBits, Events,
  REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits
} = require('discord.js');

// ─── Config ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN   = process.env.TRELLO_TOKEN;

const BOARDS = {
  luna:    process.env.TRELLO_BOARD_LUNA,    // Board ID for Luna Academy Saga
  siphnos: process.env.TRELLO_BOARD_SIPHNOS, // Board ID for Siphnos
};

// ─── Permission toggle (per guild, per board) ─────────────────────────────────
// Default: only admins can edit. Admins can toggle open for everyone.
const openPerms = new Set(); // key: `${guildId}-${board}`

function canEdit(interaction, board) {
  if (interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return true;
  return openPerms.has(`${interaction.guildId}-${board}`);
}

// ─── Trello API helper ────────────────────────────────────────────────────────
const TRELLO = 'https://api.trello.com/1';

async function trello(method, path, body = {}) {
  const url = new URL(`${TRELLO}${path}`);
  url.searchParams.set('key', TRELLO_API_KEY);
  url.searchParams.set('token', TRELLO_TOKEN);

  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET') opts.body = JSON.stringify(body);
  else Object.entries(body).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Trello error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Find a card by name (fuzzy) within a board
async function findCard(boardId, name) {
  const cards = await trello('GET', `/boards/${boardId}/cards`, { fields: 'name,id,idList,desc,labels,shortUrl' });
  const lower = name.toLowerCase();
  return cards.filter(c => c.name.toLowerCase().includes(lower));
}

// Get lists for a board
async function getLists(boardId) {
  return trello('GET', `/boards/${boardId}/lists`, { fields: 'name,id' });
}

// Find list by name
async function findList(boardId, name) {
  const lists = await getLists(boardId);
  const lower = name.toLowerCase();
  return lists.find(l => l.name.toLowerCase().includes(lower));
}

// ─── Build embed for a card ───────────────────────────────────────────────────
async function cardEmbed(card, boardName) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${card.name}`)
    .setURL(card.shortUrl)
    .setColor(0x0079BF)
    .setFooter({ text: `Board: ${boardName}` });

  if (card.desc) embed.setDescription(card.desc.slice(0, 1024));

  if (card.labels?.length) {
    embed.addFields({ name: '🏷️ Labels', value: card.labels.map(l => l.name || l.color).join(', '), inline: true });
  }

  // Fetch checklists
  try {
    const checklists = await trello('GET', `/cards/${card.id}/checklists`);
    for (const cl of checklists.slice(0, 3)) {
      const items = cl.checkItems.map(i => `${i.state === 'complete' ? '✅' : '⬜'} ${i.name}`).join('\n');
      if (items) embed.addFields({ name: `☑️ ${cl.name}`, value: items.slice(0, 1024) });
    }
  } catch {}

  return embed;
}

// ─── Slash commands ───────────────────────────────────────────────────────────
const boardChoice = opt => opt
  .setName('board')
  .setDescription('Which board?')
  .setRequired(true)
  .addChoices(
    { name: 'Luna Academy Saga', value: 'luna' },
    { name: 'Siphnos',           value: 'siphnos' },
  );

const commands = [
  // /board lists
  new SlashCommandBuilder()
    .setName('board')
    .setDescription('Board commands')
    .addSubcommand(sub => sub.setName('lists').setDescription('Show all lists on a board')
      .addStringOption(boardChoice))
    .addSubcommand(sub => sub.setName('cards').setDescription('Show all cards in a list')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('list').setDescription('List name').setRequired(true)))
    .addSubcommand(sub => sub.setName('openedit').setDescription('Allow everyone to edit (Admin only)')
      .addStringOption(boardChoice))
    .addSubcommand(sub => sub.setName('closeedit').setDescription('Restrict editing to admins (Admin only)')
      .addStringOption(boardChoice)),

  // /card
  new SlashCommandBuilder()
    .setName('card')
    .setDescription('Card commands')
    .addSubcommand(sub => sub.setName('search').setDescription('Search for a card by name')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('name').setDescription('Card name').setRequired(true)))
    .addSubcommand(sub => sub.setName('view').setDescription('View a card in detail')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('name').setDescription('Card name').setRequired(true)))
    .addSubcommand(sub => sub.setName('create').setDescription('Create a new card')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('list').setDescription('List to add card to').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Card name').setRequired(true))
      .addStringOption(o => o.setName('desc').setDescription('Description').setRequired(false)))
    .addSubcommand(sub => sub.setName('desc').setDescription('Update a card\'s description')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('name').setDescription('Card name').setRequired(true))
      .addStringOption(o => o.setName('text').setDescription('New description').setRequired(true)))
    .addSubcommand(sub => sub.setName('move').setDescription('Move a card to a different list')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('name').setDescription('Card name').setRequired(true))
      .addStringOption(o => o.setName('list').setDescription('Target list name').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete a card')
      .addStringOption(boardChoice)
      .addStringOption(o => o.setName('name').setDescription('Card name').setRequired(true))),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Commands registered!');
}

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, () => {
  console.log(`✅ Trello bot online as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const sub   = interaction.options.getSubcommand();
  const board = interaction.options.getString('board');
  const boardId = BOARDS[board];
  const boardName = board === 'luna' ? 'Luna Academy Saga' : 'Siphnos';

  await interaction.deferReply();

  try {
    // ── /board lists ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'board' && sub === 'lists') {
      const lists = await getLists(boardId);
      const embed = new EmbedBuilder()
        .setTitle(`📌 Lists — ${boardName}`)
        .setColor(0x0079BF)
        .setDescription(lists.map((l, i) => `**${i + 1}.** ${l.name}`).join('\n'));
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /board cards ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'board' && sub === 'cards') {
      const listName = interaction.options.getString('list');
      const list = await findList(boardId, listName);
      if (!list) return interaction.editReply(`❌ List "${listName}" not found!`);

      const cards = await trello('GET', `/lists/${list.id}/cards`, { fields: 'name,shortUrl' });
      if (!cards.length) return interaction.editReply(`📭 No cards in **${list.name}**`);

      const embed = new EmbedBuilder()
        .setTitle(`📋 ${list.name} — ${boardName}`)
        .setColor(0x0079BF)
        .setDescription(cards.map((c, i) => `**${i + 1}.** [${c.name}](${c.shortUrl})`).join('\n').slice(0, 4096));
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /board openedit ───────────────────────────────────────────────────────
    if (interaction.commandName === 'board' && sub === 'openedit') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
        return interaction.editReply('❌ Only admins can change this!');
      openPerms.add(`${interaction.guildId}-${board}`);
      return interaction.editReply(`✅ Everyone can now edit **${boardName}**!`);
    }

    // ── /board closeedit ──────────────────────────────────────────────────────
    if (interaction.commandName === 'board' && sub === 'closeedit') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
        return interaction.editReply('❌ Only admins can change this!');
      openPerms.delete(`${interaction.guildId}-${board}`);
      return interaction.editReply(`🔒 Editing **${boardName}** is now admin-only!`);
    }

    // ── /card search ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'card' && sub === 'search') {
      const name = interaction.options.getString('name');
      const cards = await findCard(boardId, name);
      if (!cards.length) return interaction.editReply(`❌ No cards matching "${name}"`);

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Results for "${name}" — ${boardName}`)
        .setColor(0x0079BF)
        .setDescription(cards.slice(0, 15).map((c, i) => `**${i + 1}.** [${c.name}](${c.shortUrl})`).join('\n'));
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /card view ────────────────────────────────────────────────────────────
    if (interaction.commandName === 'card' && sub === 'view') {
      const name = interaction.options.getString('name');
      const cards = await findCard(boardId, name);
      if (!cards.length) return interaction.editReply(`❌ No cards matching "${name}"`);
      if (cards.length > 1) return interaction.editReply(`⚠️ Multiple matches found:\n${cards.slice(0,5).map(c=>c.name).join('\n')}\nBe more specific!`);

      const embed = await cardEmbed(cards[0], boardName);
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /card create ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'card' && sub === 'create') {
      if (!canEdit(interaction, board)) return interaction.editReply('🔒 Editing is admin-only on this board!');

      const listName = interaction.options.getString('list');
      const name     = interaction.options.getString('name');
      const desc     = interaction.options.getString('desc') || '';
      const list     = await findList(boardId, listName);
      if (!list) return interaction.editReply(`❌ List "${listName}" not found!`);

      const card = await trello('POST', '/cards', { idList: list.id, name, desc });
      const embed = new EmbedBuilder()
        .setTitle(`✅ Card created — ${card.name}`)
        .setURL(card.shortUrl)
        .setColor(0x61BD4F)
        .setDescription(`Added to **${list.name}** on **${boardName}**`);
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /card desc ────────────────────────────────────────────────────────────
    if (interaction.commandName === 'card' && sub === 'desc') {
      if (!canEdit(interaction, board)) return interaction.editReply('🔒 Editing is admin-only on this board!');

      const name = interaction.options.getString('name');
      const text = interaction.options.getString('text');
      const cards = await findCard(boardId, name);
      if (!cards.length) return interaction.editReply(`❌ No cards matching "${name}"`);
      if (cards.length > 1) return interaction.editReply(`⚠️ Multiple matches:\n${cards.slice(0,5).map(c=>c.name).join('\n')}\nBe more specific!`);

      await trello('PUT', `/cards/${cards[0].id}`, { desc: text });
      return interaction.editReply(`✅ Description updated for **${cards[0].name}**!`);
    }

    // ── /card move ────────────────────────────────────────────────────────────
    if (interaction.commandName === 'card' && sub === 'move') {
      if (!canEdit(interaction, board)) return interaction.editReply('🔒 Editing is admin-only on this board!');

      const name     = interaction.options.getString('name');
      const listName = interaction.options.getString('list');
      const cards    = await findCard(boardId, name);
      if (!cards.length) return interaction.editReply(`❌ No cards matching "${name}"`);
      if (cards.length > 1) return interaction.editReply(`⚠️ Multiple matches:\n${cards.slice(0,5).map(c=>c.name).join('\n')}\nBe more specific!`);

      const list = await findList(boardId, listName);
      if (!list) return interaction.editReply(`❌ List "${listName}" not found!`);

      await trello('PUT', `/cards/${cards[0].id}`, { idList: list.id });
      return interaction.editReply(`✅ **${cards[0].name}** moved to **${list.name}**!`);
    }

    // ── /card delete ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'card' && sub === 'delete') {
      if (!canEdit(interaction, board)) return interaction.editReply('🔒 Editing is admin-only on this board!');

      const name  = interaction.options.getString('name');
      const cards = await findCard(boardId, name);
      if (!cards.length) return interaction.editReply(`❌ No cards matching "${name}"`);
      if (cards.length > 1) return interaction.editReply(`⚠️ Multiple matches:\n${cards.slice(0,5).map(c=>c.name).join('\n')}\nBe more specific!`);

      await trello('DELETE', `/cards/${cards[0].id}`);
      return interaction.editReply(`🗑️ **${cards[0].name}** deleted from **${boardName}**!`);
    }

  } catch (err) {
    console.error(err);
    return interaction.editReply(`❌ Something went wrong: ${err.message}`);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
