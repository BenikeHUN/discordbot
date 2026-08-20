import { SlashCommandBuilder } from 'discord.js';
import { CommandError } from '../guards.js';
import { getPlayer } from '../player.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Leave the voice channel');

export const aliases = ['dc', 'disconnect'];
export const usage = 'leave';

export async function execute(ctx) {
  const player = getPlayer(ctx.guild);
  if (!player) throw new CommandError('I am not in a voice channel.');
  player.destroy();
  await ctx.reply({ embeds: [baseEmbed('Disconnected', null)] });
}
