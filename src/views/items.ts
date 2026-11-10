import { EmbedBuilder } from "discord.js";
import type { ForeverRuleset } from "@pinta365/blizzard_api/wow-forever";
import type { HouseRef, PriceResult } from "../blizzard/auctions.ts";
import type { ItemInfo } from "../blizzard/service.ts";
import { DEFAULT_COLOR, formatMoney, num, qualityColor, relativeTime, truncate } from "./format.ts";

/** Marks items missing from Forever's item data, whose details come from Retail's and may differ. */
const RETAIL_NOTE = "Retail data";

function itemBase({ item, iconUrl }: ItemInfo): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(qualityColor(item.quality?.type)).setTitle(item.name);
    if (iconUrl) embed.setThumbnail(iconUrl);
    return embed;
}

function itemKind({ item }: ItemInfo): string {
    const parts = [item.quality?.name];
    const subclass = item.item_subclass?.name;
    const itemClass = item.item_class?.name;
    parts.push(subclass && subclass !== itemClass ? `${subclass} (${itemClass})` : itemClass);
    const slot = item.inventory_type?.name;
    if (slot && item.inventory_type.type !== "NON_EQUIP") parts.push(slot);
    return parts.filter(Boolean).join(" · ");
}

export function itemEmbed(info: ItemInfo): EmbedBuilder {
    const { item } = info;
    const preview = item.preview_item;
    const lines: string[] = [itemKind(info)];
    if (preview?.binding?.name) lines.push(preview.binding.name);
    if (preview?.unique_equipped) lines.push(preview.unique_equipped);
    if (preview?.weapon) {
        lines.push(`${preview.weapon.damage.display_string} · ${preview.weapon.attack_speed.display_string}`);
        lines.push(preview.weapon.dps.display_string);
    }
    if (preview?.armor) lines.push(preview.armor.display.display_string);
    for (const stat of preview?.stats ?? []) lines.push(stat.display.display_string);
    for (const spell of preview?.spells ?? []) lines.push(`*${spell.description}*`);
    if (preview?.durability) lines.push(preview.durability.display_string);
    if (item.description) lines.push(`*"${item.description}"*`);

    const embed = itemBase(info).setDescription(truncate(lines.join("\n"), 4000));
    const inline = (name: string, value: string) => embed.addFields({ name, value, inline: true });
    if (item.level) inline("Item level", String(item.level));
    if (item.required_level) inline("Requires level", String(item.required_level));
    if (item.sell_price) inline("Vendor sells for", formatMoney(item.sell_price));
    if (item.is_stackable && item.max_count) inline("Max stack", num(item.max_count));
    embed.setFooter({ text: info.source === "retail" ? `Item ${item.id} · ${RETAIL_NOTE}` : `Item ${item.id}` });
    return embed;
}

function houseLabel(house: HouseRef): string {
    return `${house.name} #${house.id}`;
}

export function priceEmbed(info: ItemInfo, result: PriceResult): EmbedBuilder {
    const listed = result.rows.filter((row) => row.price);
    const embed = itemBase(info);

    if (listed.length === 0) {
        const searched = result.rows.length;
        embed.setDescription(
            searched
                ? `No listings in the ${searched} auction house${searched === 1 ? "" : "s"} checked.`
                : "No auction house data could be loaded.",
        );
    } else {
        const lines = listed.map(({ house, price }) => {
            const entry = price!;
            const cost = entry.minBuyout !== undefined
                ? `from **${formatMoney(entry.minBuyout)}** each`
                : entry.minBid !== undefined
                  ? `bid only, from **${formatMoney(entry.minBid)}** each`
                  : "no price";
            return `**${houseLabel(house)}**\n${cost} · ${num(entry.quantity)} available in ${num(entry.listings)} listing${entry.listings === 1 ? "" : "s"}`;
        });
        embed.setDescription(truncate(`${itemKind(info)}\n\n${lines.join("\n")}`, 4000));
        const cheapest = listed
            .map((row) => row.price?.minBuyout)
            .filter((price) => price !== undefined)
            .sort((a, b) => a - b)[0];
        if (cheapest !== undefined && listed.length > 1) {
            embed.addFields({ name: "Lowest buyout", value: formatMoney(cheapest), inline: true });
        }
    }

    if (info.item.sell_price) {
        embed.addFields({ name: "Vendor sells for", value: formatMoney(info.item.sell_price), inline: true });
    }
    if (result.rows.length) {
        const oldest = Math.min(...result.rows.map((row) => row.fetchedAt));
        embed.addFields({ name: "Prices from", value: relativeTime(oldest), inline: true });
    }
    if (result.failed.length) {
        embed.addFields({
            name: "Couldn't load",
            value: truncate(result.failed.map(houseLabel).join(", "), 1024),
        });
    }
    embed.setFooter({
        text: [`Item ${info.item.id}`, info.source === "retail" ? RETAIL_NOTE : undefined].filter(Boolean).join(" · "),
    });
    return embed;
}

export function rulesetsEmbed(rulesets: readonly ForeverRuleset[], region: string): EmbedBuilder {
    const lines = rulesets.map((ruleset) => {
        const up = ruleset.status?.type === "UP";
        return `${up ? "🟢" : "🔴"} **${ruleset.name}** — ${ruleset.status?.name ?? "Unknown"}`;
    });
    return new EmbedBuilder()
        .setColor(DEFAULT_COLOR)
        .setTitle(`WoW: Forever rulesets (${region.toUpperCase()})`)
        .setDescription(lines.length ? lines.join("\n") : "No rulesets found.");
}
