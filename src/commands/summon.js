import { SlashCommandBuilder } from 'discord.js';
import { getOrCreatePlayer } from '../player.js';
import { requireVoiceChannel } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('summon')
  .setDescription('Join the voice channel you are in');

export const aliases = ['join', 'j'];
export const usage = 'summon';

export async function execute(ctx) {
  const voiceChannel = requireVoiceChannel(ctx);
  const player = getOrCreatePlayer(ctx.guild);
  const previous = player.voiceChannelId;

  await ctx.defer();
  player.textChannel = ctx.channel;
  await player.connect(voiceChannel);

  // Nothing queued yet, so start the idle countdown rather than sitting there.
  if (!player.current) player.scheduleLeave();

  const title = previous && previous !== voiceChannel.id ? 'Moved' : 'Joined';
  await ctx.reply({ embeds: [baseEmbed(title, `I am in ${voiceChannel} now.`)] });
}
