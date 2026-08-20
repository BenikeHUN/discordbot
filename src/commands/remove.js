import { SlashCommandBuilder } from 'discord.js';
import { CommandError, requireActivePlayer } from '../guards.js';
import { baseEmbed, trackLine } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Remove one track from the queue')
  .addIntegerOption((option) => option
    .setName('position')
    .setDescription('Position shown by the queue command')
    .setRequired(true)
    .setMinValue(1));

export const aliases = ['rm'];
export const usage = 'remove <position>';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  const position = ctx.getInteger('position', true);
  const removed = player.remove(position - 1);
  if (!removed) throw new CommandError(`There is no track at position ${position}.`);
  await ctx.reply({ embeds: [baseEmbed('Removed', trackLine(removed))] });
}
