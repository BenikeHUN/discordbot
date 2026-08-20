import {
  ApplicationCommandOptionType,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionsBitField,
} from 'discord.js';
import { assertConfig, config, prepareTempDir, resolveBinaries } from './config.js';
import { commands, findCommand, loadCommands } from './load-commands.js';
import { deployCommands } from './deploy-commands.js';
import { CommandError } from './guards.js';
import { InteractionContext, MessageContext } from './context.js';
import { allPlayers, getPlayer, playerEvents } from './player.js';
import { baseEmbed, trackEmbed } from './format.js';

assertConfig();
await loadCommands();

prepareTempDir();

// Pick binaries that actually run here before anyone can issue a command.
try {
  await resolveBinaries();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Panels cannot easily run a one off command, so registration can be asked for
// with an environment variable instead. Text commands never need this.
if (config.deployCommands) {
  try {
    await deployCommands();
  } catch (error) {
    console.error(`Could not register slash commands: ${error.message}`);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Exactly what the bot needs: read and answer in text channels, and play in
// voice. Nothing here lets it moderate or manage anything.
const INVITE_PERMISSIONS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.Connect,
  PermissionsBitField.Flags.Speak,
];

client.once(Events.ClientReady, (ready) => {
  console.log(`Logged in as ${ready.user.tag}`);
  console.log(`Prefix: ${config.prefix}`);
  console.log(`yt-dlp: ${config.ytDlpPath}`);
  console.log(`ffmpeg: ${config.ffmpegPath}`);
  console.log(`Serving ${ready.guilds.cache.size} server(s)`);

  const invite = ready.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: INVITE_PERMISSIONS,
  });
  console.log(`
Invite link:
${invite}
`);

  ready.user.setActivity(`${config.prefix}help`);
});

async function run(command, ctx) {
  try {
    await command.execute(ctx);
  } catch (error) {
    const expected = error instanceof CommandError;
    if (!expected) console.error(`Command ${command.data.name} failed:`, error);
    const embed = baseEmbed(null, expected ? error.message : `Something went wrong: ${error.message}`)
      .setColor(0xed4245);
    await ctx.fail({ embeds: [embed] }).catch(() => {});
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      // An autocomplete failure is not worth surfacing to the user.
      await command.autocomplete(interaction).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'These commands only work inside a server.' });
    return;
  }

  await run(command, new InteractionContext(interaction));
});

/**
 * Maps the words after the prefix onto the slash command's options, so a
 * command file does not have to know which of the two it is serving.
 * The last string option swallows the rest of the line.
 */
function parseArguments(command, rest) {
  const specs = command.data.toJSON().options ?? [];
  const options = {};
  let remaining = rest.trim();

  specs.forEach((spec, index) => {
    if (!remaining) return;
    const isLast = index === specs.length - 1;

    if (spec.type === ApplicationCommandOptionType.String && isLast) {
      options[spec.name] = remaining;
      remaining = '';
      return;
    }

    const [token] = remaining.split(/\s+/, 1);
    options[spec.name] = token;
    remaining = remaining.slice(token.length).trimStart();
  });

  const missing = specs.find((spec) => spec.required && options[spec.name] === undefined);
  if (missing) {
    const hint = command.usage ?? command.data.name;
    throw new CommandError(`Missing \`${missing.name}\`. Usage: \`${config.prefix}${hint}\``);
  }

  return options;
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild()) return;
  if (!message.content.startsWith(config.prefix)) return;

  const withoutPrefix = message.content.slice(config.prefix.length).trimStart();
  const [name] = withoutPrefix.split(/\s+/, 1);
  if (!name) return;

  const command = findCommand(name.toLowerCase());
  if (!command) return;

  const canReply = message.channel
    .permissionsFor(message.guild.members.me)
    ?.has(PermissionsBitField.Flags.SendMessages);
  if (!canReply) return;

  const rest = withoutPrefix.slice(name.length);
  let ctx;
  try {
    ctx = new MessageContext(message, parseArguments(command, rest));
  } catch (error) {
    const embed = baseEmbed(null, error.message).setColor(0xed4245);
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
    return;
  }

  await run(command, ctx);
});

// Leave on our own once every human has left the channel.
client.on(Events.VoiceStateUpdate, (oldState) => {
  const player = getPlayer(oldState.guild);
  if (!player?.voiceChannelId) return;

  const channel = oldState.guild.channels.cache.get(player.voiceChannelId);
  if (!channel || channel.type === ChannelType.GuildText) return;

  const humans = channel.members.filter((member) => !member.user.bot).size;
  if (humans === 0) player.scheduleLeave(true);
  else player.clearLeaveTimer();
});

// Announce track changes in the channel where the last play command was used.
playerEvents.on('create', (player) => {
  player.on('trackStart', (track) => {
    if (player.suppressAnnounce) {
      player.suppressAnnounce = false;
      return;
    }
    player.textChannel?.send({ embeds: [trackEmbed('Now playing', track)] }).catch(() => {});
  });

  player.on('error', (error, track) => {
    console.error(`Player error in guild ${player.guild.id}:`, error);
    const label = track ? `**${track.title}**` : 'the current track';
    player.textChannel?.send({
      embeds: [baseEmbed(null, `Could not play ${label}: ${error.message}`).setColor(0xed4245)],
    }).catch(() => {});
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const player of allPlayers()) player.destroy();
    client.destroy();
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

try {
  await client.login(config.token);
} catch (error) {
  if (error.message?.includes('disallowed intents')) {
    console.error(
      'Login refused because the Message Content intent is off.\n'
      + 'Open https://discord.com/developers/applications, pick your app, go to Bot,\n'
      + 'and switch on "Message Content Intent" under Privileged Gateway Intents.',
    );
    process.exit(1);
  }
  throw error;
}
