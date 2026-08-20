import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { assertConfig, config } from './config.js';
import { commands, loadCommands } from './load-commands.js';

/** Registers every command with Discord. Safe to call more than once. */
export async function deployCommands() {
  assertConfig({ needsClientId: true });
  if (commands.size === 0) await loadCommands();

  const body = [...commands.values()].map((command) => command.data.toJSON());
  const rest = new REST().setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const result = await rest.put(route, { body });
  const scope = config.guildId ? `guild ${config.guildId}` : 'globally';
  console.log(`Registered ${result.length} slash command(s) ${scope}: ${result.map((c) => c.name).join(', ')}`);
  return result;
}

// Also usable on its own through npm run deploy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await deployCommands();
}
