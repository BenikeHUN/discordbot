import { SlashCommandBuilder } from 'discord.js';
import { CommandError } from '../guards.js';
import { getPlayer } from '../player.js';
import { progressBar, trackEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Show what is playing right now');

export const aliases = ['np'];
export const usage = 'nowplaying';

export async function execute(ctx) {
  const player = getPlayer(ctx.guild);
  if (!player?.current) throw new CommandError('Nothing is playing right now.');

  const track = player.current;
  const embed = trackEmbed(player.paused ? 'Paused' : 'Now playing', track)
    .addFields({ name: 'Progress', value: `\`${progressBar(player.elapsed, track.duration)}\`` })
    .setFooter({ text: `Volume: ${player.volume}%` });

  await ctx.reply({ embeds: [embed] });
}
