import { errors } from "@pinta365/blizzard_api";
import { type Interaction, MessageFlags } from "discord.js";
import { character } from "./character.ts";
import { claim, claims, unclaim, who } from "./claims.ts";
import { guild } from "./guild.ts";
import { item, price, rulesets } from "./market.ts";
import type { BotContext, Command } from "./types.ts";

export const commands: readonly Command[] = [character, guild, who, claim, unclaim, claims, price, item, rulesets];

const byName = new Map(commands.map((command) => [command.data.name, command]));

/** What to tell the player when a command throws. */
export function errorMessage(error: unknown): string {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    if (error instanceof errors.AuthenticationError || status === 401 || status === 403) {
        return "The Blizzard API rejected the bot's credentials. Whoever runs the bot should check `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`.";
    }
    if (status === 429) return "The Blizzard API is rate limiting the bot. Try again in a minute.";
    if (status && status >= 500) return "The Blizzard API is having trouble right now. Try again in a minute.";
    return "Something went wrong looking that up. Try again in a minute.";
}

/** Routes a Discord interaction to its command. Never throws. */
export async function handleInteraction(interaction: Interaction, ctx: BotContext): Promise<void> {
    if (interaction.isAutocomplete()) {
        const choices = await byName
            .get(interaction.commandName)
            ?.autocomplete?.(interaction, ctx)
            .catch((error) => {
                console.warn(`[autocomplete] /${interaction.commandName} failed:`, (error as Error).message);
                return [];
            });
        await interaction.respond(choices ?? []).catch(() => {});
        return;
    }

    if (interaction.isButton()) {
        const prefix = interaction.customId.split("|")[0];
        const command = commands.find((entry) => entry.buttonPrefix === prefix);
        try {
            await command?.button?.(interaction, ctx);
        } catch (error) {
            console.error(`[button] ${interaction.customId} failed:`, error);
            await interaction.followUp({ content: errorMessage(error), flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = byName.get(interaction.commandName);
    if (!command) return;
    try {
        await command.execute(interaction, ctx);
    } catch (error) {
        console.error(`[command] /${interaction.commandName} failed:`, error);
        const content = errorMessage(error);
        const reply = interaction.deferred || interaction.replied
            ? interaction.editReply({ content, embeds: [], components: [] })
            : interaction.reply({ content, flags: MessageFlags.Ephemeral });
        await reply.catch(() => {});
    }
}
