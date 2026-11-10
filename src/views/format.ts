/** Formatting helpers shared by the embeds. */

export const DEFAULT_COLOR = 0xc79c6e;

/** Class colours by playable class ID, as used on the in-game raid frames. */
const CLASS_COLORS: Record<number, number> = {
    1: 0xc69b6d, // Warrior
    2: 0xf48cba, // Paladin
    3: 0xaad372, // Hunter
    4: 0xfff468, // Rogue
    5: 0xffffff, // Priest
    6: 0xc41e3a, // Death Knight
    7: 0x0070dd, // Shaman
    8: 0x3fc7eb, // Mage
    9: 0x8788ee, // Warlock
    10: 0x00ff98, // Monk
    11: 0xff7c0a, // Druid
    12: 0xa330c9, // Demon Hunter
    13: 0x33937f, // Evoker
};

const QUALITIES: Record<string, { color: number; icon: string }> = {
    POOR: { color: 0x9d9d9d, icon: "⚫" },
    COMMON: { color: 0xffffff, icon: "⚪" },
    UNCOMMON: { color: 0x1eff00, icon: "🟢" },
    RARE: { color: 0x0070dd, icon: "🔵" },
    EPIC: { color: 0xa335ee, icon: "🟣" },
    LEGENDARY: { color: 0xff8000, icon: "🟠" },
    ARTIFACT: { color: 0xe6cc80, icon: "🟡" },
    HEIRLOOM: { color: 0x00ccff, icon: "🔷" },
};

const FACTION_COLORS: Record<string, number> = {
    HORDE: 0xb30000,
    ALLIANCE: 0x004a93,
};

export function classColor(classId: number | undefined): number {
    return (classId !== undefined ? CLASS_COLORS[classId] : undefined) ?? DEFAULT_COLOR;
}

export function qualityColor(quality: string | undefined): number {
    return QUALITIES[quality ?? ""]?.color ?? DEFAULT_COLOR;
}

export function qualityIcon(quality: string | undefined): string {
    return QUALITIES[quality ?? ""]?.icon ?? "▫️";
}

export function factionColor(faction: string | undefined): number {
    return FACTION_COLORS[faction?.toUpperCase() ?? ""] ?? DEFAULT_COLOR;
}

export function num(value: number): string {
    return value.toLocaleString("en-US");
}

/** Copper as gold, silver and copper: `12g 34s 56c`. Zero parts are left out. */
export function formatMoney(copper: number): string {
    const total = Math.max(0, Math.round(copper));
    const gold = Math.floor(total / 10_000);
    const silver = Math.floor((total % 10_000) / 100);
    const rest = total % 100;
    const parts: string[] = [];
    if (gold) parts.push(`${num(gold)}g`);
    if (silver) parts.push(`${silver}s`);
    if (rest || parts.length === 0) parts.push(`${rest}c`);
    return parts.join(" ");
}

/** A Discord timestamp that renders as "3 hours ago" in each reader's own time zone. */
export function relativeTime(timestampMs: number): string {
    return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

export function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Joins lines up to `max` characters, ending with a "+N more" line when some don't fit. */
export function fitLines(lines: readonly string[], max: number): string {
    const kept: string[] = [];
    let length = 0;
    for (const [index, line] of lines.entries()) {
        const remaining = lines.length - index;
        const tail = `…and ${remaining} more`;
        if (length + line.length + 1 > max - tail.length - 1) {
            kept.push(tail);
            break;
        }
        kept.push(line);
        length += line.length + 1;
    }
    return kept.join("\n");
}

export function percent(value: number | undefined): string {
    return `${(value ?? 0).toFixed(2)}%`;
}

/** Escapes Discord markdown in text that comes from the API (names can't hold these, but be safe). */
export function escapeMarkdown(text: string): string {
    return text.replace(/([\\*_~`|>])/g, "\\$1");
}
