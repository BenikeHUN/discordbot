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
const known = await check('known public playlist', `/playlists/${KNOWN_PLAYLIST}?fields=name`);
const mine = await check('your playlist', `/playlists/${idFrom(process.argv[2], KNOWN_PLAYLIST)}?fields=name`);

console.log('\nWhat that means:');
if (!track && !album) {
  console.log('  Nothing works. The app itself is restricted, or the credentials belong');
  console.log('  to an app that was removed. Check it on developer.spotify.com/dashboard.');
} else if (!known && !mine) {
  console.log('  Tracks and albums work, no playlist does, not even a public one that is');
  console.log('  not yours. Spotify is refusing playlist reads to this app entirely, and');
  console.log('  no setting on your own playlist will change that.');
} else if (known && !mine) {
  console.log('  Public playlists work but yours does not, so it is your playlist that is');
  console.log('  not public. In Spotify, three dots, then Add to profile or Public.');
} else {
  console.log('  Everything the bot needs works. If playback still fails, the problem is');
  console.log('  no longer with Spotify access.');
}
process.exit(0);
