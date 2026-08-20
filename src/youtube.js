import { spawn } from 'node:child_process';
import { config } from './config.js';
import { isSpotifyUrl, resolveSpotify } from './spotify.js';

const URL_RE = /^https?:\/\//i;

// yt-dlp exposes a search for each of these. Anything else has to be a link.
const SEARCH_SOURCES = {
  yt: 'ytsearch',
  youtube: 'ytsearch',
  sc: 'scsearch',
  soundcloud: 'scsearch',
};
const SOURCE_PREFIX_RE = /^(yt|youtube|sc|soundcloud):\s*/i;

function baseArgs() {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-cache-dir',
    '--no-part',
    '--retries', '3',
    '--socket-timeout', '15',
  ];
  if (config.cookiesPath) args.push('--cookies', config.cookiesPath);
  return args;
}

function runJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytDlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });

    child.on('error', (error) => {
      reject(new Error(`Could not start yt-dlp (${config.ytDlpPath}): ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim().split('\n').pop() || `yt-dlp exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('yt-dlp returned a response that could not be parsed'));
      }
    });
  });
}

/** Readable stand in for a title, for sources whose listings omit one. */
function titleFromUrl(url) {
  try {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    if (!slug || /^[0-9]+$/.test(slug)) return null;
    return slug.replace(/[-_]+/g, ' ').trim() || null;
  } catch {
    return null;
  }
}

function toTrack(info, requestedBy) {
  const id = info.id ?? null;
  const extractor = (info.extractor_key || info.ie_key || '').toLowerCase();
  const isYouTube = extractor.startsWith('youtube')
    || /(?:youtube\.com|youtu\.be)/i.test(info.webpage_url ?? info.url ?? '');

  const url = info.webpage_url
    || info.original_url
    || info.url
    || (isYouTube && id ? `https://www.youtube.com/watch?v=${id}` : null);

  return {
    id,
    url,
    title: info.title || titleFromUrl(url) || 'Unknown title',
    // SoundCloud set listings carry only a URL, so the real metadata has to be
    // fetched later. YouTube listings already include everything.
    needsMetadata: !info.title,
    author: info.uploader || info.channel || info.uploader_id || 'Unknown channel',
    duration: Number.isFinite(info.duration) ? Math.round(info.duration) : null,
    isLive: Boolean(info.is_live),
    source: extractor || (isYouTube ? 'youtube' : 'link'),
    streamUrl: url,
    thumbnail: info.thumbnail
      || info.thumbnails?.at(-1)?.url
      || (isYouTube && id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
    requestedBy,
  };
}

function isPlaylistUrl(query) {
  if (!URL_RE.test(query)) return false;
  try {
    const url = new URL(query);
    // YouTube marks a playlist with list=, SoundCloud with a /sets/ segment.
    return url.searchParams.has('list')
      || url.pathname.startsWith('/playlist')
      || url.pathname.includes('/sets/');
  } catch {
    return false;
  }
}

/**
 * Turns whatever the user typed into a list of playable tracks.
 * Accepts a video URL, a playlist URL, or free text to search for.
 */
export async function resolveQuery(query, requestedBy) {
  const trimmed = query.trim();

  if (isSpotifyUrl(trimmed)) {
    const { playlistTitle, tracks } = await resolveSpotify(trimmed, requestedBy, config.maxQueueSize);
    return {
      source: tracks.length > 1 ? 'playlist' : 'url',
      playlistTitle,
      tracks,
    };
  }

  if (isPlaylistUrl(trimmed)) {
    const info = await runJson([
      ...baseArgs(),
      '--dump-single-json',
      '--flat-playlist',
      '--yes-playlist',
      trimmed,
    ]);
    const entries = (info.entries ?? []).filter((entry) => entry && entry.id);
    if (entries.length === 0) throw new Error('That playlist is empty or private.');
    return {
      source: 'playlist',
      playlistTitle: info.title || 'Playlist',
      tracks: entries.map((entry) => toTrack(entry, requestedBy)),
    };
  }

  if (URL_RE.test(trimmed)) {
    const info = await runJson([
      ...baseArgs(),
      '--dump-single-json',
      '--no-playlist',
      trimmed,
    ]);
    return { source: 'url', playlistTitle: null, tracks: [toTrack(info, requestedBy)] };
  }

  const results = await search(trimmed, 1, requestedBy);
  if (results.length === 0) throw new Error(`No results for "${trimmed}".`);
  return { source: 'search', playlistTitle: null, tracks: results };
}

/** Splits an optional "sc:" or "yt:" prefix off a search query. */
export function splitSearchSource(query) {
  const match = query.match(SOURCE_PREFIX_RE);
  if (!match) return { engine: 'ytsearch', terms: query };
  return {
    engine: SEARCH_SOURCES[match[1].toLowerCase()],
    terms: query.slice(match[0].length).trim(),
  };
}

export async function search(query, limit, requestedBy) {
  const { engine, terms } = splitSearchSource(query);
  if (!terms) throw new Error('Type something to search for.');

  const info = await runJson([
    ...baseArgs(),
    '--dump-single-json',
    '--flat-playlist',
    `${engine}${limit}:${terms}`,
  ]);
  return (info.entries ?? [])
    .filter((entry) => entry && entry.id)
    .map((entry) => toTrack(entry, requestedBy));
}

/** Fills in the fields a flat listing left out, just before playback. */
export async function hydrateTrack(track) {
  const info = await runJson([
    ...baseArgs(),
    '--dump-single-json',
    '--no-playlist',
    track.streamUrl ?? track.url,
  ]);

  const fresh = toTrack(info, track.requestedBy);
  Object.assign(track, {
    title: fresh.title,
    author: fresh.author,
    duration: fresh.duration,
    thumbnail: fresh.thumbnail ?? track.thumbnail,
    isLive: fresh.isLive,
    url: fresh.url ?? track.url,
    streamUrl: fresh.streamUrl ?? track.streamUrl,
    needsMetadata: false,
  });
  return track;
}

/**
 * Spawns yt-dlp and pipes its output through ffmpeg, producing signed 16 bit
 * little endian PCM at 48 kHz stereo. PCM rather than Ogg/Opus because inline
 * volume has to scale the samples before they are encoded.
 */
export function createTrackStream(track) {
  const ytdlp = spawn(config.ytDlpPath, [
    ...baseArgs(),
    '--no-playlist',
    '--quiet',
    '--format', 'bestaudio[acodec=opus]/bestaudio/best',
    '--output', '-',
    track.streamUrl ?? track.url,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  const ffmpeg = spawn(config.ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-analyzeduration', '0',
    '-i', 'pipe:0',
    '-vn',
    '-ar', '48000',
    '-ac', '2',
    '-f', 's16le',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  let ytDlpError = '';
  ytdlp.stderr.setEncoding('utf8');
  ytdlp.stderr.on('data', (chunk) => { ytDlpError += chunk; });
  ffmpeg.stderr.resume();

  // Broken pipes are normal when a track is skipped, so they are swallowed here.
  const ignore = () => {};
  ytdlp.stdout.on('error', ignore);
  ffmpeg.stdin.on('error', ignore);
  ytdlp.on('error', ignore);
  ffmpeg.on('error', ignore);

  ytdlp.stdout.pipe(ffmpeg.stdin);

  const destroy = () => {
    ytdlp.kill('SIGKILL');
    ffmpeg.kill('SIGKILL');
  };

  ytdlp.on('close', (code) => {
    if (code !== 0 && code !== null) {
      ffmpeg.stdin.end();
    }
  });
  ffmpeg.on('close', () => {
    if (!ytdlp.killed) ytdlp.kill('SIGKILL');
  });

  return {
    stream: ffmpeg.stdout,
    destroy,
    getError: () => ytDlpError.trim().split('\n').filter(Boolean).pop() || null,
  };
}
