import { SlashCommandBuilder } from 'discord.js';
import { requireActivePlayer } from '../guards.js';
import { baseEmbed, trackLine } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Skip the current track');

export const aliases = ['s', 'next'];
export const usage = 'skip';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  const skipped = player.current;
  player.skip();
  await ctx.reply({ embeds: [baseEmbed('Skipped', skipped ? trackLine(skipped) : 'Moving on.')] });
}
