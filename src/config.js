import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the yt-dlp binary this project manages itself lives. Kept outside
 * node_modules so npm operations cannot wipe it, and fetched by
 * scripts/setup-ytdlp.js rather than by a wrapper package, because the popular
 * wrappers install the Python zipapp build and hard fail without python3.
 */
export const bundledYtDlp = path.join(
  projectRoot,
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
);

function ffmpegStaticPath() {
  try {
    return require('ffmpeg-static') || null;
  } catch {
    return null;
  }
}

/**
 * Candidates in order of preference. Existing on disk is not enough, since a
 * glibc build sitting in a musl container runs into a missing loader, so these
 * get probed before one is picked.
 */
export function ytDlpCandidates() {
  return [process.env.YTDLP_PATH, existsSync(bundledYtDlp) ? bundledYtDlp : null, 'yt-dlp']
    .filter(Boolean);
}

export function ffmpegCandidates() {
  const bundled = ffmpegStaticPath();
  return [process.env.FFMPEG_PATH, bundled && existsSync(bundled) ? bundled : null, 'ffmpeg']
    .filter(Boolean);
}

/** Resolves true when the binary exists and actually runs on this system. */
export function probeBinary(binary, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 20_000);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export async function firstWorking(candidates, args) {
  for (const candidate of candidates) {
    // Deliberately sequential: the first that runs wins, no point racing.
    // eslint-disable-next-line no-await-in-loop
    if (await probeBinary(candidate, args)) return candidate;
  }
  return null;
}

/**
 * Reads a whole number from the environment. An empty or unparseable value
 * falls back rather than becoming 0 or NaN, because panels and compose files
 * routinely pass an empty string for a setting nobody filled in, and NaN in
 * particular turns a timeout into "fire immediately".
 */
function intEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt((process.env[name] ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  deployCommands: /^(1|true|yes)$/i.test(process.env.DEPLOY_COMMANDS ?? ''),
  prefix: process.env.PREFIX || '.',
  ytDlpPath: ytDlpCandidates()[0] ?? 'yt-dlp',
  ffmpegPath: ffmpegCandidates()[0] ?? 'ffmpeg',
  cookiesPath: process.env.YTDLP_COOKIES || null,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || null,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
  leaveTimeout: intEnv('LEAVE_TIMEOUT', 120, { max: 86_400 }) * 1000,
  maxQueueSize: 500,
  defaultVolume: intEnv('DEFAULT_VOLUME', 100, { max: 1000 }),
  maxVolume: intEnv('MAX_VOLUME', 200, { max: 1000 }),
  volumeRampMs: intEnv('VOLUME_RAMP_MS', 1500, { max: 10_000 }),
  fadeInMs: intEnv('FADE_IN_MS', 1500, { max: 30_000 }),
  fadeInFrom: intEnv('FADE_IN_FROM', 50, { max: 1000 }),
};

/**
 * Picks binaries that run here rather than ones that merely exist. Panels like
 * Pterodactyl hand out Alpine containers where the bundled glibc builds are
 * present but unusable, while a working ffmpeg sits on the PATH.
 */
export async function resolveBinaries() {
  const [ytDlp, ffmpeg] = await Promise.all([
    firstWorking(ytDlpCandidates()),
    firstWorking(ffmpegCandidates(), ['-version']),
  ]);

  if (!ytDlp) {
    throw new Error(
      'No working yt-dlp found. Run "npm run setup-ytdlp" to fetch one, '
      + 'or set YTDLP_PATH to a copy that runs on this system.',
    );
  }
  if (!ffmpeg) {
    throw new Error(
      'No working ffmpeg found. Install ffmpeg, or set FFMPEG_PATH to a copy '
      + 'that runs on this system.',
    );
  }

  config.ytDlpPath = ytDlp;
  config.ffmpegPath = ffmpeg;
  return { ytDlp, ffmpeg };
}

export function assertConfig({ needsClientId = false } = {}) {
  if (!config.token) throw new Error('DISCORD_TOKEN is missing from .env');
  if (needsClientId && !config.clientId) throw new Error('CLIENT_ID is missing from .env');
}
