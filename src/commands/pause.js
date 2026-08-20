import { SlashCommandBuilder } from 'discord.js';
import { CommandError, requireActivePlayer } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause playback');

export const usage = 'pause';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  if (!player.pause()) throw new CommandError('Playback is not running.');
  await ctx.reply({ embeds: [baseEmbed('Paused', 'Use resume to continue.')] });
}
