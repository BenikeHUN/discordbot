import { config } from './config.js';

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const LINK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album|playlist)[/:]([A-Za-z0-9]+)/i;

let cachedToken = null;
let tokenExpiresAt = 0;

export function isSpotifyUrl(value) {
  return LINK_RE.test(value);
}

export const isConfigured = () => Boolean(config.spotifyClientId && config.spotifyClientSecret);

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const credentials = Buffer
    .from(`${config.spotifyClientId}:${config.spotifyClientSecret}`)
    .toString('base64');

  const response = await fetch(ACCOUNTS, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(
      response.status === 400 || response.status === 401
        ? 'Spotify rejected the client ID or secret. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.'
        : `Spotify token request failed with ${response.status}.`,
    );
  }

  const body = await response.json();
  cachedToken = body.access_token;
  // Renew a minute early so a request never races the expiry.
  tokenExpiresAt = Date.now() + (body.expires_in - 60) * 1000;
  return cachedToken;
}

async function api(pathOrUrl) {
  const token = await getToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (response.status === 404) throw new Error('That Spotify link does not exist, or it is private.');
  if (response.status === 429) throw new Error('Spotify is rate limiting the bot. Try again shortly.');
  if (!response.ok) throw new Error(`Spotify request failed with ${response.status}.`);

  return response.json();
}

/** Walks a paged Spotify collection until the item cap is reached. */
async function collect(firstPath, limit) {
  const items = [];
  let next = firstPath;

  while (next && items.length < limit) {
    const page = await api(next);
    items.push(...(page.items ?? []));
    next = page.next;
  }

  return items.slice(0, limit);
}

function artistNames(artists) {
  return (artists ?? []).map((artist) => artist.name).filter(Boolean).join(', ') || 'Unknown artist';
}

/**
 * Spotify audio cannot be streamed by third parties, so a Spotify track is
 * carried as metadata plus a search query. The player looks up the matching
 * YouTube video the moment the track is about to play, not before, so queueing
 * a 200 track playlist costs one API call rather than 200 searches.
 */
function toTrack(raw, requestedBy, fallbackImage = null) {
  const artists = artistNames(raw.artists);
  const image = raw.album?.images?.[0]?.url ?? fallbackImage;

  return {
    id: raw.id ?? null,
    url: raw.external_urls?.spotify ?? `https://open.spotify.com/track/${raw.id}`,
    title: raw.name || 'Unknown title',
    author: artists,
    duration: Number.isFinite(raw.duration_ms) ? Math.round(raw.duration_ms / 1000) : null,
    isLive: false,
    thumbnail: image,
    source: 'spotify',
    searchQuery: `${artists} ${raw.name}`,
    streamUrl: null,
    requestedBy,
  };
}

export async function resolveSpotify(link, requestedBy, limit) {
  if (!isConfigured()) {
    throw new Error(
      'Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env. '
      + 'Create an app at https://developer.spotify.com/dashboard to get them.',
    );
  }

  const [, kind, id] = link.match(LINK_RE);

  if (kind.toLowerCase() === 'track') {
    const raw = await api(`/tracks/${id}`);
    return { playlistTitle: null, tracks: [toTrack(raw, requestedBy)] };
  }

  if (kind.toLowerCase() === 'album') {
    const album = await api(`/albums/${id}`);
    const cover = album.images?.[0]?.url ?? null;
    const items = await collect(`/albums/${id}/tracks?limit=50`, limit);
    const tracks = items.filter(Boolean).map((raw) => toTrack(raw, requestedBy, cover));
    if (tracks.length === 0) throw new Error('That album has no playable tracks.');
    return { playlistTitle: `${album.name} by ${artistNames(album.artists)}`, tracks };
  }

  const playlist = await api(`/playlists/${id}?fields=name`);
  const items = await collect(`/playlists/${id}/tracks?limit=100`, limit);
  const tracks = items
    .map((item) => item?.track)
    // Local files and removed entries come back without an id and cannot be searched.
    .filter((raw) => raw && raw.id && raw.type !== 'episode')
    .map((raw) => toTrack(raw, requestedBy));

  if (tracks.length === 0) throw new Error('That playlist has no playable tracks.');
  return { playlistTitle: playlist.name || 'Spotify playlist', tracks };
}
