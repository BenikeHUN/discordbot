import { SlashCommandBuilder } from 'discord.js';
import { requireActivePlayer } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop playback and clear the queue');

export const usage = 'stop';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  player.stop();
  await ctx.reply({ embeds: [baseEmbed('Stopped', 'The queue has been cleared.')] });
}
