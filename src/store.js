import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'guilds.json');
const tempFile = `${file}.tmp`;

let settings = {};
let pending = null;

function load() {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A truncated or hand edited file should not stop the bot from starting.
    console.warn(`Ignoring unreadable ${file}, starting from defaults.`);
    return {};
  }
}

function write() {
  pending = null;
  try {
    mkdirSync(config.dataDir, { recursive: true });
    // Written beside the real file and moved into place, so a crash midway
    // leaves the previous settings intact rather than half a file.
    writeFileSync(tempFile, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(tempFile, file);
  } catch (error) {
    console.warn(`Could not save guild settings: ${error.message}`);
  }
}

export function loadSettings() {
  settings = load();
}

export function getGuildSetting(guildId, key) {
  return settings[guildId]?.[key];
}

/** Records a setting and schedules a save, so a volume slide is not one write per step. */
export function setGuildSetting(guildId, key, value) {
  settings[guildId] ??= {};
  if (settings[guildId][key] === value) return;
  settings[guildId][key] = value;

  if (pending) return;
  pending = setTimeout(write, 1_000);
  pending.unref();
}

/** Writes immediately, for shutdown. */
export function flushSettings() {
  if (!pending) return;
  clearTimeout(pending);
  write();
}
