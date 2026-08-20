import { EmbedBuilder } from 'discord.js';

export const ACCENT = 0x5865f2;

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'LIVE';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function totalDuration(tracks) {
  return tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
}

export function progressBar(elapsedMs, durationSeconds, width = 20) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return `${'-'.repeat(width)} LIVE`;
  }
  const ratio = Math.min(elapsedMs / (durationSeconds * 1000), 1);
  const position = Math.max(Math.round(ratio * (width - 1)), 0);
  const bar = '-'.repeat(position) + '#' + '-'.repeat(width - 1 - position);
  return `${bar} ${formatDuration(elapsedMs / 1000)} / ${formatDuration(durationSeconds)}`;
}

export function trackLine(track) {
  return `[${track.title}](${track.url}) \`${formatDuration(track.duration)}\``;
}

export function baseEmbed(title, description) {
  const embed = new EmbedBuilder().setColor(ACCENT);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function trackEmbed(title, track) {
  const embed = baseEmbed(title, trackLine(track))
    .addFields({ name: 'Channel', value: track.author, inline: true });
  if (track.requestedBy) {
    embed.addFields({ name: 'Requested by', value: track.requestedBy, inline: true });
  }
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}
