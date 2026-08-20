import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { commands } from '../load-commands.js';
import { baseEmbed } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List every command');

export const aliases = ['h', 'commands'];
export const usage = 'help';

export async function execute(ctx) {
  const lines = [...commands.values()]
    .sort((a, b) => a.data.name.localeCompare(b.data.name))
    .map((command) => {
      const names = [command.data.name, ...(command.aliases ?? [])]
        .map((name) => `\`${config.prefix}${name}\``)
        .join(' ');
      return `${names}\n${command.data.description}`;
    });

  const embed = baseEmbed('Commands', lines.join('\n\n'))
    .setFooter({ text: `Prefix: ${config.prefix} | slash commands work too` });

  await ctx.reply({ embeds: [embed] });
}
