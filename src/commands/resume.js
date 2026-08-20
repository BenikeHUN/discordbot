import { SlashCommandBuilder } from 'discord.js';
import { CommandError, requireActivePlayer } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume playback');

export const aliases = ['unpause'];
export const usage = 'resume';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  if (!player.resume()) throw new CommandError('Playback is not paused.');
  await ctx.reply({ embeds: [baseEmbed('Resumed', null)] });
}
