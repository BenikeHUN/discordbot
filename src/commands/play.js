import { SlashCommandBuilder } from 'discord.js';
import { getOrCreatePlayer } from '../player.js';
import { resolveQuery, search } from '../youtube.js';
import { requireVoiceChannel } from '../guards.js';
import { baseEmbed, formatDuration, totalDuration, trackEmbed } from '../format.js';
import { playerComponents } from '../components.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a link or search by name')
  .addStringOption((option) => option
    .setName('query')
    .setDescription('YouTube, SoundCloud or Spotify link, or search terms. Prefix with sc: to search SoundCloud')
    .setRequired(true)
    .setAutocomplete(true));

export const aliases = ['p'];
export const usage = 'play <link or search terms>';

export async function autocomplete(interaction) {
  const value = interaction.options.getFocused();
  if (!value || value.length < 3 || /^https?:\/\//i.test(value)) {
    await interaction.respond([]);
    return;
  }
  try {
    const results = await search(value, 5, null);
    await interaction.respond(results.map((track) => ({
      name: `${track.title} (${formatDuration(track.duration)})`.slice(0, 100),
      value: track.url.slice(0, 100),
    })));
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(ctx) {
  const voiceChannel = requireVoiceChannel(ctx);
  const query = ctx.getString('query', true);

  await ctx.defer();

  const result = await resolveQuery(query, `<@${ctx.user.id}>`);
  const player = getOrCreatePlayer(ctx.guild);
  player.textChannel = ctx.channel;

  await player.connect(voiceChannel);

  const wasIdle = !player.current;
  const added = player.enqueue(result.tracks);
  if (added === 0) throw new Error('The queue is full.');

  // A single track reply already reads "Now playing", so the announcement
  // would repeat it. A playlist reply names the playlist rather than the
  // track, so the announcement is left to post, and it carries the controls.
  const single = result.source !== 'playlist';
  if (wasIdle && single) player.suppressAnnounce = true;

  await player.start();

  if (result.source === 'playlist') {
    const embed = baseEmbed(
      'Playlist queued',
      `**${result.playlistTitle}**\n${added} track(s), ${formatDuration(totalDuration(result.tracks))} total`,
    );
    await ctx.reply({ embeds: [embed] });
    return;
  }

  const track = result.tracks[0];
  const title = wasIdle ? 'Now playing' : `Queued at position ${player.queue.length}`;
  await ctx.reply({
    embeds: [trackEmbed(title, track)],
    components: wasIdle ? playerComponents(player) : [],
  });

  // This reply is the now playing message, so the next track edits it rather
  // than posting a second one underneath.
  if (wasIdle) player.nowPlayingMessage = await ctx.sentMessage();
}
