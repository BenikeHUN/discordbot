import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getOrCreatePlayer } from '../player.js';
import { requireSameVoiceChannel } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('volume')
  .setDescription('Show or set the volume in percent')
  .addIntegerOption((option) => option
    .setName('percent')
    .setDescription(`0 to ${config.maxVolume}, 100 is the original level`)
    .setMinValue(0)
    .setMaxValue(config.maxVolume));

export const aliases = ['vol', 'v'];
export const usage = `volume [0-${config.maxVolume}]`;

export async function execute(ctx) {
  // Deliberately not requireActivePlayer: the level can be set up front and
  // then applies to whatever gets queued next.
  const player = getOrCreatePlayer(ctx.guild);
  const requested = ctx.getInteger('percent');

  if (requested === null) {
    await ctx.reply({ embeds: [baseEmbed('Volume', `Currently at **${player.volume}%**.`)] });
    return;
  }

  // Only guard while something is actually audible to other people.
  if (player.current) requireSameVoiceChannel(ctx, player);

  const applied = player.setVolume(requested);
  const note = applied !== requested ? ` (capped at ${config.maxVolume}%)` : '';
  const suffix = player.current ? '' : ' It applies to the next track.';
  await ctx.reply({ embeds: [baseEmbed('Volume', `Set to **${applied}%**${note}.${suffix}`)] });
}
