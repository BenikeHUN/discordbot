import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');

/** Command name to module. Filled by loadCommands, read by the help command. */
export const commands = new Map();

/** Alias or name to command name. */
export const aliasIndex = new Map();

export async function loadCommands() {
  const files = (await readdir(commandsDir)).filter((file) => file.endsWith('.js'));

  for (const file of files) {
    const module = await import(pathToFileURL(path.join(commandsDir, file)).href);
    if (!module.data || typeof module.execute !== 'function') {
      throw new Error(`Command file ${file} must export "data" and "execute".`);
    }

    const name = module.data.name;
    commands.set(name, module);
    aliasIndex.set(name, name);
    for (const alias of module.aliases ?? []) {
      const owner = aliasIndex.get(alias);
      if (owner && owner !== name) {
        throw new Error(`Alias "${alias}" is claimed by both ${owner} and ${name}.`);
      }
      aliasIndex.set(alias, name);
    }
  }

  return commands;
}

export function findCommand(nameOrAlias) {
  const name = aliasIndex.get(nameOrAlias);
  return name ? commands.get(name) : null;
}
