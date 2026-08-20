import { PermissionsBitField } from 'discord.js';
import { getPlayer } from './player.js';

export class CommandError extends Error {}

export function requireVoiceChannel(ctx) {
  const channel = ctx.member?.voice?.channel;
  if (!channel) throw new CommandError('Join a voice channel first.');

  const permissions = channel.permissionsFor(ctx.guild.members.me);
  if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
    throw new CommandError(`I am not allowed to join ${channel}.`);
  }
  if (!permissions.has(PermissionsBitField.Flags.Speak)) {
    throw new CommandError(`I am not allowed to speak in ${channel}.`);
  }
  return channel;
}

/** Blocks anyone who is not listening along from touching a live player. */
export function requireSameVoiceChannel(ctx, player) {
  const userChannel = ctx.member?.voice?.channelId;
  if (player.voiceChannelId && userChannel !== player.voiceChannelId) {
    throw new CommandError('You have to be in my voice channel to use that.');
  }
  return player;
}

/** Returns the active player, and makes sure the user is listening along. */
export function requireActivePlayer(ctx) {
  const player = getPlayer(ctx.guild);
  if (!player || (!player.current && player.queue.length === 0)) {
    throw new CommandError('Nothing is playing right now.');
  }
  return requireSameVoiceChannel(ctx, player);
}
