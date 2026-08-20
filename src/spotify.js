import { config } from './config.js';

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const LINK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album|playlist)[/:]([A-Za-z0-9]+)/i;

let cachedToken = null;
let tokenExpiresAt = 0;

// Spotify's February 2026 change: a playlist now returns its contents only to
// the token of the person who owns it. An application token has no owner, so it
// gets metadata and nothing else, whatever the playlist's privacy setting says.
const PLAYLISTS_CLOSED = 'Spotify stopped giving playlist contents to apps in February 2026. '
  + 'Only a login belonging to the owner can read them now, so nothing about the '
  + 'playlist settings will help, and this is not something the bot can work around. '
  + 'Album and track links still work, and a YouTube playlist link works too.';

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

/** Spotify puts the useful part in the body, not the status line. */
async function describeFailure(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.error_description || '';
  } catch {
    // No JSON body, the status has to speak for itself.
  }

  if (response.status === 403 || response.status === 404) {
    if (response.url.includes('/playlists/')) return PLAYLISTS_CLOSED;

    return `Spotify refused that link${detail ? `: ${detail}` : ''}. `
      + 'Check that it is public and still exists.';
  }

  if (response.status === 429) return 'Spotify is rate limiting the bot. Try again shortly.';

  return `Spotify request failed with ${response.status}${detail ? `: ${detail}` : ''}.`;
}

async function api(pathOrUrl) {
  const token = await getToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  // A token can lapse between being handed out and being used. One retry with
  // a fresh one costs little and saves the user a confusing failure.
  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    const retryToken = await getToken();
    response = await fetch(url, { headers: { Authorization: `Bearer ${retryToken}` } });
  }

  if (!response.ok) throw new Error(await describeFailure(response));

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
  // /tracks was removed in February 2026 in favour of /items. The old path is
  // still tried as a fallback, since apps on extended quota kept it.
  const items = await collect(`/playlists/${id}/items?limit=100`, limit)
    .catch(() => collect(`/playlists/${id}/tracks?limit=100`, limit));

  const tracks = items
    // The entry wrapper was renamed from track to item in the same change.
    .map((entry) => entry?.item ?? entry?.track)
    // Local files and removed entries come back without an id and cannot be searched.
    .filter((raw) => raw && raw.id && raw.type !== 'episode')
    .map((raw) => toTrack(raw, requestedBy));

  // Metadata came back but no contents, which is exactly what an app token gets
  // for a playlist it does not own.
  if (tracks.length === 0) throw new Error(PLAYLISTS_CLOSED);
  return { playlistTitle: playlist.name || 'Spotify playlist', tracks };
}
