import { SlashCommandBuilder } from 'discord.js';
import { CommandError } from '../guards.js';
import { LoopMode, getPlayer } from '../player.js';
import { baseEmbed, formatDuration, totalDuration, trackLine } from '../format.js';

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Show the queue')
  .addIntegerOption((option) => option
    .setName('page')
    .setDescription('Page number')
    .setMinValue(1));

export const aliases = ['q'];
export const usage = 'queue [page]';

export async function execute(ctx) {
  const player = getPlayer(ctx.guild);
  if (!player || (!player.current && player.queue.length === 0)) {
    throw new CommandError('The queue is empty.');
  }

  const pages = Math.max(Math.ceil(player.queue.length / PAGE_SIZE), 1);
  const page = Math.min(Math.max(ctx.getInteger('page') ?? 1, 1), pages);
  const start = (page - 1) * PAGE_SIZE;
  const slice = player.queue.slice(start, start + PAGE_SIZE);

  const lines = slice.map((track, index) => `\`${start + index + 1}.\` ${trackLine(track)}`);
  const embed = baseEmbed('Queue', lines.join('\n') || 'Nothing queued after the current track.');

  if (player.current) {
    embed.addFields({ name: 'Now playing', value: trackLine(player.current) });
  }

  const loopLabel = { [LoopMode.Off]: 'off', [LoopMode.Track]: 'track', [LoopMode.Queue]: 'queue' };
  embed.setFooter({
    text: `Page ${page}/${pages} | ${player.queue.length} queued | `
      + `${formatDuration(totalDuration(player.queue))} left | loop: ${loopLabel[player.loop]}`
      + ` | volume: ${player.volume}%`,
  });

  await ctx.reply({ embeds: [embed] });
}
