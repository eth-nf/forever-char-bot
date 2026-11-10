import { errors } from "@pinta365/blizzard_api";
import type { Locales, WowApi, WowForeverApi } from "@pinta365/blizzard_api";
import type { Item } from "@pinta365/blizzard_api/wow";
import type {
    ForeverCharacterEquipment,
    ForeverCharacterMedia,
    ForeverCharacterProfessions,
    ForeverCharacterProfile,
    ForeverCharacterPvpSummary,
    ForeverCharacterReputations,
    ForeverCharacterSpecializations,
    ForeverCharacterStatistics,
    ForeverGuild,
    ForeverGuildRoster,
    ForeverRuleset,
} from "@pinta365/blizzard_api/wow-forever";
import { TtlCache } from "../util/cache.ts";
import { type CharacterName, characterSlug, guildSlug } from "./names.ts";

/** The Forever endpoints the bot uses. Narrowed so tests can supply a small fake. */
export type ForeverApi = Pick<
    WowForeverApi,
    | "characterProfile"
    | "characterMedia"
    | "characterEquipments"
    | "characterStatistics"
    | "characterSpecializations"
    | "characterProfessions"
    | "characterReputations"
    | "characterPvpSummary"
    | "guild"
    | "guildRoster"
    | "playableClasses"
    | "playableRaces"
    | "rulesets"
    | "ruleset"
    | "item"
    | "itemMedia"
    | "searchItem"
>;

/** Retail endpoints, used as a fallback for items missing from Forever's item data. */
export type RetailApi = Pick<WowApi, "item" | "itemMedia" | "searchItem">;

export type ItemSource = "forever" | "retail";

export interface ItemInfo {
    item: Item;
    /** Where the item data came from. Retail stats may differ from Forever's. */
    source: ItemSource;
    iconUrl?: string;
}

export interface ItemHit {
    id: number;
    name: string;
    /** Quality type, e.g. `RARE`. */
    quality?: string;
    source: ItemSource;
}

export interface CharacterOverview {
    profile: ForeverCharacterProfile;
    avatarUrl?: string;
    specializations?: ForeverCharacterSpecializations;
    pvp?: ForeverCharacterPvpSummary;
    professions?: ForeverCharacterProfessions;
}

export interface GuildMember {
    name: string;
    surname: string;
    slug: string;
    level: number;
    rank: number;
    classId: number;
    className: string;
    raceId: number;
    raceName: string;
}

/** The little that is known about a character from either its profile or a guild roster. */
export interface CharacterSummary {
    name: string;
    surname: string;
    slug: string;
    level?: number;
    classId?: number;
    className?: string;
    raceName?: string;
    guildName?: string;
}

export interface GuildOverview {
    guild: ForeverGuild;
    members: GuildMember[];
}

export function isNotFound(error: unknown): boolean {
    return (
        (error instanceof errors.APIError || error instanceof Error) &&
        (error as { statusCode?: number }).statusCode === 404
    );
}

/** Resolves to undefined instead of throwing on a 404. Other errors still throw. */
async function optional<T>(request: Promise<T>): Promise<T | undefined> {
    try {
        return await request;
    } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
    }
}

/** For extras that shouldn't fail the whole reply: resolves to undefined on any error. */
async function soft<T>(what: string, request: Promise<T>): Promise<T | undefined> {
    try {
        return await request;
    } catch (error) {
        if (!isNotFound(error)) console.warn(`[blizzard] ${what} failed:`, (error as Error).message);
        return undefined;
    }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface SearchResultData {
    id?: number;
    name?: Record<string, string>;
    quality?: { type?: string };
}

function parseSearchHits(results: unknown[], locale: Locales, source: ItemSource): ItemHit[] {
    const hits: ItemHit[] = [];
    for (const result of results) {
        const data = (result as { data?: SearchResultData } | null)?.data;
        const name = data?.name?.[locale] ?? data?.name?.en_US;
        if (typeof data?.id !== "number" || !name) continue;
        hits.push({ id: data.id, name, quality: data.quality?.type, source });
    }
    return hits;
}

/** Lower is a better match of `name` for what was typed. */
function matchRank(name: string, query: string): number {
    const lower = name.toLowerCase();
    if (lower === query) return 0;
    if (lower.startsWith(query)) return 1;
    if (lower.includes(query)) return 2;
    return 3;
}

/**
 * Everything the bot reads from the Blizzard API except auctions, with caching. Character data is a snapshot of the
 * last logout anyway, so short caches lose nothing and keep bursts of commands cheap.
 */
export class ForeverService {
    readonly #forever: ForeverApi;
    readonly #retail: RetailApi;
    readonly #locale: Locales;

    readonly #characters = new TtlCache<unknown>(2 * MINUTE);
    readonly #guilds = new TtlCache<GuildOverview | undefined>(5 * MINUTE, 100);
    readonly #static = new TtlCache<unknown>(24 * HOUR);
    readonly #items = new TtlCache<ItemInfo | undefined>(24 * HOUR, 5000);
    readonly #searches = new TtlCache<ItemHit[]>(30 * MINUTE, 500);
    readonly #rulesets = new TtlCache<ForeverRuleset[]>(MINUTE);

    constructor(forever: ForeverApi, retail: RetailApi, locale: Locales) {
        this.#forever = forever;
        this.#retail = retail;
        this.#locale = locale;
    }

    #character<T>(kind: string, who: CharacterName, load: () => Promise<T>): Promise<T> {
        return this.#characters.get(`${kind}:${characterSlug(who)}`, load) as Promise<T>;
    }

    /** The character's profile, or undefined if the API doesn't serve the character (yet). */
    profile(who: CharacterName): Promise<ForeverCharacterProfile | undefined> {
        return this.#character("profile", who, () => optional(this.#forever.characterProfile(who.name, who.surname)));
    }

    /** The profile plus the extras shown on the character card. Extras that fail are left out. */
    async overview(who: CharacterName): Promise<CharacterOverview | undefined> {
        const { name, surname } = who;
        const [profile, media, specializations, pvp, professions] = await Promise.all([
            this.profile(who),
            this.#media(who),
            this.specializations(who).catch(() => undefined),
            this.#character("pvp", who, () => soft("pvp summary", this.#forever.characterPvpSummary(name, surname))),
            this.professions(who).catch(() => undefined),
        ]);
        if (!profile) return undefined;
        const avatarUrl = media?.assets?.find((asset) => asset.key === "avatar")?.value;
        return { profile, avatarUrl, specializations, pvp, professions };
    }

    /**
     * Confirms a character exists and returns its proper name. Characters below level 10 have no profile yet, but
     * are on their guild's roster, so `guildName`'s roster is the fallback.
     */
    async summarize(who: CharacterName, guildName?: string): Promise<CharacterSummary | undefined> {
        const profile = await this.profile(who);
        if (profile) {
            return {
                name: profile.name,
                surname: profile.surname,
                slug: characterSlug(profile),
                level: profile.level,
                classId: profile.character_class?.id,
                className: profile.character_class?.name,
                raceName: profile.race?.name,
                guildName: profile.guild?.name,
            };
        }
        if (!guildName) return undefined;
        const overview = await this.guild(guildName);
        const member = overview?.members.find((entry) => entry.slug === characterSlug(who));
        if (!overview || !member) return undefined;
        const { name, surname, slug, level, classId, className, raceName } = member;
        return { name, surname, slug, level, classId, className, raceName, guildName: overview.guild.name };
    }

    /** The character's media assets. Undefined until Blizzard has rendered them, which lags behind the profile. */
    #media(who: CharacterName): Promise<ForeverCharacterMedia | undefined> {
        return this.#character("media", who, () =>
            soft("character media", this.#forever.characterMedia(who.name, who.surname)),
        );
    }

    /** URL of the full-body render on a transparent background (`main-raw`), if there is one yet. */
    async renderUrl(who: CharacterName): Promise<string | undefined> {
        const media = await this.#media(who);
        return media?.assets?.find((asset) => asset.key === "main-raw")?.value;
    }

    equipment(who: CharacterName): Promise<ForeverCharacterEquipment | undefined> {
        return this.#character("gear", who, () => optional(this.#forever.characterEquipments(who.name, who.surname)));
    }

    statistics(who: CharacterName): Promise<ForeverCharacterStatistics | undefined> {
        return this.#character("stats", who, () => optional(this.#forever.characterStatistics(who.name, who.surname)));
    }

    specializations(who: CharacterName): Promise<ForeverCharacterSpecializations | undefined> {
        return this.#character("specs", who, () =>
            optional(this.#forever.characterSpecializations(who.name, who.surname)),
        );
    }

    professions(who: CharacterName): Promise<ForeverCharacterProfessions | undefined> {
        return this.#character("professions", who, () =>
            optional(this.#forever.characterProfessions(who.name, who.surname)),
        );
    }

    reputations(who: CharacterName): Promise<ForeverCharacterReputations | undefined> {
        return this.#character("reputations", who, () =>
            optional(this.#forever.characterReputations(who.name, who.surname)),
        );
    }

    /** Class names by ID. The roster only has IDs. */
    classNames(): Promise<Map<number, string>> {
        return this.#static.get("classes", async () => {
            const index = await this.#forever.playableClasses();
            return new Map(index.classes.map((entry) => [entry.id, entry.name]));
        }) as Promise<Map<number, string>>;
    }

    raceNames(): Promise<Map<number, string>> {
        return this.#static.get("races", async () => {
            const index = await this.#forever.playableRaces();
            return new Map(index.races.map((entry) => [entry.id, entry.name]));
        }) as Promise<Map<number, string>>;
    }

    /** A guild and its roster with class and race names filled in, or undefined if there is no such guild. */
    guild(guildName: string): Promise<GuildOverview | undefined> {
        const slug = guildSlug(guildName);
        return this.#guilds.get(slug, async () => {
            const [guild, roster, classes, races] = await Promise.all([
                optional(this.#forever.guild(slug)),
                optional(this.#forever.guildRoster(slug)),
                soft("class index", this.classNames()),
                soft("race index", this.raceNames()),
            ]);
            if (!guild) return undefined;
            return { guild, members: toMembers(roster, classes, races) };
        });
    }

    /** The guild if it is already cached. Used by autocomplete, which can't wait for a request. */
    cachedGuild(guildName: string): GuildOverview | undefined {
        return this.#guilds.peek(guildSlug(guildName));
    }

    /** Every ruleset of the region with its status. */
    rulesets(): Promise<ForeverRuleset[]> {
        return this.#rulesets.get("all", async () => {
            const index = await this.#forever.rulesets();
            const rulesets = await Promise.all(
                index.rulesets.map((entry) => soft(`ruleset ${entry.id}`, this.#forever.ruleset(entry.id))),
            );
            return rulesets.filter((ruleset) => ruleset !== undefined).sort((a, b) => a.id - b.id);
        });
    }

    /**
     * An item by ID. Forever's item data is incomplete (about 4 in 10 auctioned items are missing), so Retail's is the
     * fallback: good for the name, quality and icon, but its stats may differ.
     */
    item(id: number): Promise<ItemInfo | undefined> {
        return this.#items.get(String(id), async () => {
            for (const [source, api] of [["forever", this.#forever], ["retail", this.#retail]] as const) {
                const item = await soft(`${source} item ${id}`, api.item(id));
                if (!item) continue;
                const media = await soft(`${source} item media ${id}`, api.itemMedia(id));
                const iconUrl = media?.assets?.find((asset) => asset.key === "icon")?.value;
                return { item, source, iconUrl };
            }
            return undefined;
        });
    }

    /** Items whose name matches, Forever's first, best match first. */
    searchItems(query: string, limit = 25): Promise<ItemHit[]> {
        const needle = query.trim().toLowerCase();
        if (!needle) return Promise.resolve([]);
        return this.#searches.get(`${needle}:${limit}`, async () => {
            const parameters = { searchFields: { [`name.${this.#locale}`]: needle }, pageSize: 50 };
            const [forever, retail] = await Promise.all([
                soft("forever item search", this.#forever.searchItem(parameters)),
                soft("retail item search", this.#retail.searchItem(parameters)),
            ]);
            const hits = parseSearchHits(forever?.results ?? [], this.#locale, "forever");
            const seen = new Set(hits.map((hit) => hit.id));
            for (const hit of parseSearchHits(retail?.results ?? [], this.#locale, "retail")) {
                if (!seen.has(hit.id)) hits.push(hit);
            }
            const sourceRank = (hit: ItemHit) => (hit.source === "forever" ? 0 : 1);
            return hits
                .sort(
                    (a, b) =>
                        matchRank(a.name, needle) - matchRank(b.name, needle) ||
                        sourceRank(a) - sourceRank(b) ||
                        a.name.localeCompare(b.name),
                )
                .slice(0, limit);
        });
    }

    /**
     * Resolves what a player typed (or picked from autocomplete) to an item: a numeric ID, or the best name match.
     */
    async resolveItem(input: string): Promise<ItemInfo | undefined> {
        const text = input.trim();
        if (/^\d+$/.test(text)) return this.item(Number(text));
        const [best] = await this.searchItems(text);
        return best ? this.item(best.id) : undefined;
    }
}

function toMembers(
    roster: ForeverGuildRoster | undefined,
    classes: Map<number, string> | undefined,
    races: Map<number, string> | undefined,
): GuildMember[] {
    return (roster?.members ?? []).map(({ character, rank }) => ({
        name: character.name,
        surname: character.surname,
        slug: character.slug,
        level: character.level,
        rank,
        classId: character.playable_class.id,
        className: classes?.get(character.playable_class.id) ?? `Class ${character.playable_class.id}`,
        raceId: character.playable_race.id,
        raceName: races?.get(character.playable_race.id) ?? `Race ${character.playable_race.id}`,
    }));
}
