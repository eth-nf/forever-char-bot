import { type ApplicationCommandOptionChoiceData, SlashCommandBuilder } from "discord.js";
import type { PlayerFaction } from "../config.ts";
import { itemEmbed, priceEmbed, rulesetsEmbed } from "../views/items.ts";
import { truncate } from "../views/format.ts";
import { type BotContext, type Command, within } from "./types.ts";

const itemOption = (option: import("discord.js").SlashCommandStringOption) =>
    option.setName("item").setDescription("Item name or ID").setRequired(true).setAutocomplete(true);

/** Item suggestions for what was typed. Items that are for sale right now come first once auction data is loaded. */
async function itemChoices(ctx: BotContext, typed: string): Promise<ApplicationCommandOptionChoiceData[]> {
    if (typed.trim().length < 2) return [];
    const hits = await within(2500, ctx.forever.searchItems(typed), []);
    const listedRank = (id: number) => (ctx.auctions.isListed(id) === true ? 0 : 1);
    const names = new Map<string, number>();
    for (const hit of hits) names.set(hit.name, (names.get(hit.name) ?? 0) + 1);
    return hits
        .map((hit, index) => ({ hit, index }))
        .sort((a, b) => listedRank(a.hit.id) - listedRank(b.hit.id) || a.index - b.index)
        .slice(0, 25)
        .map(({ hit }) => ({
            // Several items can share a name; the ID tells them apart.
            name: truncate((names.get(hit.name) ?? 0) > 1 ? `${hit.name} (#${hit.id})` : hit.name, 100),
            value: String(hit.id),
        }));
}

function itemNotFound(input: string): string {
    return `I couldn't find an item matching **${input}**.`;
}

export const price: Command = {
    data: new SlashCommandBuilder()
        .setName("price")
        .setDescription("Look up an item's price on the auction house")
        .addStringOption(itemOption)
        .addStringOption((option) =>
            option
                .setName("faction")
                .setDescription("Whose auction houses to check")
                .addChoices(
                    { name: "Horde", value: "horde" },
                    { name: "Alliance", value: "alliance" },
                    { name: "All", value: "all" },
                ),
        ),

    async execute(interaction, ctx) {
        await interaction.deferReply();
        const input = interaction.options.getString("item", true);
        const info = await ctx.forever.resolveItem(input);
        if (!info) {
            await interaction.editReply(itemNotFound(input));
            return;
        }
        const choice = interaction.options.getString("faction") ?? ctx.config.defaultFaction ?? "all";
        const faction = choice === "all" ? undefined : (choice as PlayerFaction);
        const result = await ctx.auctions.prices(info.item.id, faction);
        await interaction.editReply({ embeds: [priceEmbed(info, result)] });
    },

    async autocomplete(interaction, ctx) {
        return itemChoices(ctx, interaction.options.getFocused());
    },
};

export const item: Command = {
    data: new SlashCommandBuilder().setName("item").setDescription("Show an item's tooltip").addStringOption(itemOption),

    async execute(interaction, ctx) {
        await interaction.deferReply();
        const input = interaction.options.getString("item", true);
        const info = await ctx.forever.resolveItem(input);
        await interaction.editReply(info ? { embeds: [itemEmbed(info)] } : { content: itemNotFound(input) });
    },

    async autocomplete(interaction, ctx) {
        return itemChoices(ctx, interaction.options.getFocused());
    },
};

export const rulesets: Command = {
    data: new SlashCommandBuilder().setName("rulesets").setDescription("Show the WoW: Forever rulesets and whether they're up"),

    async execute(interaction, ctx) {
        await interaction.deferReply();
        const all = await ctx.forever.rulesets();
        await interaction.editReply({ embeds: [rulesetsEmbed(all, ctx.config.blizzard.region)] });
    },
};
