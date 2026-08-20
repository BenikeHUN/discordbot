// Reports exactly which Spotify endpoints this app's credentials can reach.
//
// Spotify answers a refused request with a bare "Forbidden" often enough that
// guessing from one failure is pointless. Reading a known public track, a known
// public album and the playlist in question separates the three explanations:
// bad credentials, an app Spotify has restricted, and a playlist that is not
// public.
//
// Run it with the same environment the bot uses:
//   node scripts/spotify-check.js [playlist url or id]
import 'dotenv/config';
import { config } from '../src/config.js';

const KNOWN_TRACK = '4PTG3Z6ehGkBFwjybzWkR8';
const KNOWN_ALBUM = '6N9PS4QXF1D0OWPk0Sxtb4';
const KNOWN_PLAYLIST = '3cEYpjA9oz9GiPac4AsH4n';

function idFrom(value, fallback) {
  if (!value) return fallback;
  const match = value.match(/(?:playlist[/:])([A-Za-z0-9]+)/);
  return match ? match[1] : value.trim();
}

if (!config.spotifyClientId || !config.spotifyClientSecret) {
  console.log('SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is not set, nothing to check.');
  process.exit(0);
}

console.log(`Client ID ends in ...${config.spotifyClientId.slice(-4)}`);

const credentials = Buffer
  .from(`${config.spotifyClientId}:${config.spotifyClientSecret}`)
  .toString('base64');

const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});

if (!tokenResponse.ok) {
  const body = await tokenResponse.text();
  console.log(`\nToken request failed with ${tokenResponse.status}: ${body.slice(0, 200)}`);
  console.log('The client ID and secret are wrong, or the app was deleted.');
  process.exit(1);
}

const { access_token: token } = await tokenResponse.json();
console.log('Token: ok\n');

async function check(label, path) {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let detail = '';
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.name || '';
  } catch {
    detail = body.slice(0, 80);
  }

  console.log(`${label.padEnd(28)} ${response.status} ${detail}`);
  return response.ok;
}

const track = await check('known public track', `/tracks/${KNOWN_TRACK}`);
const album = await check('known public album', `/albums/${KNOWN_ALBUM}`);
const id = idFrom(process.argv[2], KNOWN_PLAYLIST);

const meta = await check('your playlist, metadata', `/playlists/${id}?fields=name`);
const items = await check('your playlist, contents', `/playlists/${id}/items?limit=1`);
const legacy = await check('same, removed endpoint', `/playlists/${id}/tracks?limit=1`);

console.log('');
console.log('What that means:');
if (!track && !album) {
  console.log('  Nothing works. The app itself is restricted, or the credentials belong');
  console.log('  to an app that was removed. Check it on developer.spotify.com/dashboard.');
} else if (!items && !legacy) {
  console.log('  Tracks and albums work, playlist contents do not. Since February 2026');
  console.log('  Spotify returns a playlist to an application token as metadata only.');
  console.log('  The contents go to a login belonging to the owner and to nobody else.');
  console.log('  Nothing about the playlist settings changes this, and the bot cannot');
  console.log('  work around it. Use an album or track link, or a YouTube playlist.');
  if (meta) console.log('  The metadata call succeeding above is exactly that behaviour.');
} else {
  console.log('  Playlist contents came back, so this app can still read them. If a');
  console.log('  playlist link still fails, the problem is elsewhere.');
}
process.exit(0);
