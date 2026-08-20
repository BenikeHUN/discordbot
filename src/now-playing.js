import { config } from './config.js';

/**
 * Keeps one message per guild showing what is playing, editing it on every
 * track change rather than pushing a fresh message into the channel each time.
 * Falls back to a new message when there is nothing to edit: no message yet,
 * it was deleted, or the last play command came from a different channel.
 */
export async function showNowPlaying(player, payload) {
  const channel = player.textChannel;
  if (!channel) return;

  const existing = player.nowPlayingMessage;
  const buried = player.messagesSinceNowPlaying >= config.repostAfter;

  if (existing && existing.channelId === channel.id && !buried) {
    try {
      await existing.edit(payload);
      return;
    } catch {
      player.nowPlayingMessage = null;
    }
  }

  const replaced = player.nowPlayingMessage;
  player.nowPlayingMessage = await channel.send(payload).catch(() => null);
  player.messagesSinceNowPlaying = 0;

  // Only once the new one is up, so a failed send does not leave the guild
  // with no controls at all.
  if (replaced && player.nowPlayingMessage) await replaced.delete().catch(() => {});
}

