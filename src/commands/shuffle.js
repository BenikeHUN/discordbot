import { SlashCommandBuilder } from 'discord.js';
import { CommandError, requireActivePlayer } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('shuffle')
  .setDescription('Shuffle the queue');

export const usage = 'shuffle';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  if (player.queue.length < 2) throw new CommandError('There is not enough in the queue to shuffle.');
  const count = player.shuffle();
  await ctx.reply({ embeds: [baseEmbed('Shuffled', `${count} tracks reordered.`)] });
}
