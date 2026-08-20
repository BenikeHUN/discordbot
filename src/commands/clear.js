import { SlashCommandBuilder } from 'discord.js';
import { CommandError, requireActivePlayer } from '../guards.js';
import { baseEmbed, trackLine } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Remove everything from the queue, keeping the current track');

export const aliases = ['cl', 'empty'];
export const usage = 'clear';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  const removed = player.clearQueue();
  if (removed === 0) throw new CommandError('The queue is already empty.');

  const still = player.current
    ? `\nStill playing ${trackLine(player.current)}`
    : '';
  await ctx.reply({
    embeds: [baseEmbed('Queue cleared', `Removed ${removed} track(s).${still}`)],
  });
}
