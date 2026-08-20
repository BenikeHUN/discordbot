import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config.js';
import { LoopMode } from './player.js';

export const BUTTON_PREFIX = 'player';
export const VOLUME_STEP = 10;

const LOOP_LABEL = {
  [LoopMode.Off]: 'Loop: off',
  [LoopMode.Track]: 'Loop: track',
  [LoopMode.Queue]: 'Loop: queue',
};

function button(action, label, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(`${BUTTON_PREFIX}:${action}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

/**
 * Controls for the now playing message. Rendered from the player's current
 * state, so a message re-rendered after a press shows what actually happened
 * rather than what was clicked.
 */
export function playerComponents(player) {
  if (!player || player.destroyed) return [];
  const idle = !player.current;

  return [
    new ActionRowBuilder().addComponents(
      button('previous', 'Previous', ButtonStyle.Secondary, player.history.length === 0),
      button('playpause', player.paused ? 'Resume' : 'Pause', ButtonStyle.Primary, idle),
      button('skip', 'Skip', ButtonStyle.Secondary, idle),
      button('stop', 'Stop', ButtonStyle.Danger, idle && player.queue.length === 0),
      button('loop', LOOP_LABEL[player.loop], ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      button('volume-down', `Vol -${VOLUME_STEP}`, ButtonStyle.Secondary, player.volume <= 0),
      button('volume-up', `Vol +${VOLUME_STEP}`, ButtonStyle.Secondary, player.volume >= config.maxVolume),
      button('shuffle', 'Shuffle', ButtonStyle.Secondary, player.queue.length < 2),
      button('queue', 'Queue', ButtonStyle.Secondary),
    ),
  ];
}
