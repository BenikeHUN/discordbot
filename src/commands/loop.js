import { SlashCommandBuilder } from 'discord.js';
import { LoopMode } from '../player.js';
import { CommandError, requireActivePlayer } from '../guards.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('loop')
  .setDescription('Set the repeat mode')
  .addStringOption((option) => option
    .setName('mode')
    .setDescription('What to repeat')
    .setRequired(true)
    .addChoices(
      { name: 'off', value: LoopMode.Off },
      { name: 'track', value: LoopMode.Track },
      { name: 'queue', value: LoopMode.Queue },
    ));

export const aliases = ['repeat'];
export const usage = 'loop <off|track|queue>';

export async function execute(ctx) {
  const player = requireActivePlayer(ctx);
  const mode = ctx.getString('mode', true).trim().toLowerCase();
  if (!Object.values(LoopMode).includes(mode)) {
    throw new CommandError('Pick one of: off, track, queue.');
  }

  player.loop = mode;
  const description = {
    [LoopMode.Off]: 'Repeat is off.',
    [LoopMode.Track]: 'Repeating the current track.',
    [LoopMode.Queue]: 'Repeating the whole queue.',
  }[mode];
  await ctx.reply({ embeds: [baseEmbed('Loop', description)] });
}
