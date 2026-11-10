/**
 * A fake Blizzard API for the offline tests. The responses follow the library's response types (which are checked
 * against the live API), with made-up values around the test character: Chaos Chris, an Orc Warlock on the
 * US Roleplay PvP ruleset.
 */
import { errors } from "@pinta365/blizzard_api";
import { AuctionService, type AuctionApi } from "../src/blizzard/auctions.ts";
import { ForeverService, type ForeverApi, type RetailApi } from "../src/blizzard/service.ts";
import { ClaimStore } from "../src/claims/store.ts";
import type { BotContext } from "../src/commands/types.ts";
import type { Config } from "../src/config.ts";

const href = (path: string) => ({ href: `https://us.api.blizzard.com${path}` });
const self = (path: string) => ({ _links: { self: href(path) } });

export function notFound(): Error {
    return new errors.APIError("Not Found", 404, '{"code":404,"type":"BLZWEBAPI00000404","detail":"Not Found"}');
}

const characterRef = { key: href("/profile/wow/character/chaos-chris"), name: "Chaos", surname: "Chris", id: 4242, slug: "chaos-chris" };

export const profile = {
    ...self("/profile/wow/character/chaos-chris"),
    id: 4242,
    name: "Chaos",
    surname: "Chris",
    gender: { type: "MALE", name: "Male" },
    faction: { type: "HORDE", name: "Horde" },
    race: { key: href("/data/wow/playable-race/2"), name: "Orc", id: 2 },
    character_class: { key: href("/data/wow/playable-class/9"), name: "Warlock", id: 9 },
    ruleset: { key: href("/data/wow/ruleset/15"), name: "Roleplay PvP", id: 15 },
    guild: { key: href("/data/wow/guild/burning-legion"), name: "Burning Legion", id: 77, faction: { type: "HORDE", name: "Horde" }, slug: "burning-legion" },
    level: 24,
    experience: 1200,
    achievement_points: 0,
    last_login_timestamp: 1_794_300_000_000,
    average_item_level: 22,
    equipped_item_level: 21,
    name_search: "CHAOS CHRIS",
    is_remix: false,
};

export const media = {
    ...self("/profile/wow/character/chaos-chris/character-media"),
    character: characterRef,
    assets: [
        { key: "avatar", value: "https://render.worldofwarcraft.com/forever-us/character/20/4242-avatar.jpg" },
        { key: "main-raw", value: "https://render.worldofwarcraft.com/forever-us/character/20/4242-main-raw.png" },
    ],
};

const talent = (name: string, rank: number) => ({
    talent: { name, id: 1 },
    spell_tooltip: { spell: { name, id: 1 }, description: "", cast_time: "Passive" },
    talent_rank: rank,
});

export const specializations = {
    ...self("/profile/wow/character/chaos-chris/specializations"),
    character: characterRef,
    specialization_groups: [
        {
            is_active: true,
            specializations: [
                { specialization: { key: href("/x"), name: "Affliction", id: 302 }, specialization_name: "Affliction", spent_points: 10, talents: [talent("Improved Corruption", 5), talent("Suppression", 5)] },
                { specialization: { key: href("/x"), name: "Demonology", id: 303 }, specialization_name: "Demonology", spent_points: 5, talents: [talent("Demonic Embrace", 5)] },
                { specialization: { key: href("/x"), name: "Destruction", id: 301 }, specialization_name: "Destruction", spent_points: 0, talents: [] },
            ],
        },
    ],
};

export const pvp = { ...self("/pvp"), character: characterRef, honorable_kills: 37, pvp_rank: 2 };

export const professions = {
    ...self("/professions"),
    character: characterRef,
    primaries: [
        { profession: { key: href("/x"), name: "Tailoring", id: 197 }, skill_points: 110, max_skill_points: 150 },
        { profession: { key: href("/x"), name: "Enchanting", id: 333 }, tiers: [{ skill_points: 95, max_skill_points: 150, tier: { name: "Journeyman", id: 1 }, known_recipes: [{ key: href("/x"), name: "Runed Copper Rod", id: 1 }] }] },
    ],
    secondaries: [{ profession: { key: href("/x"), name: "First Aid", id: 129 }, skill_points: 80, max_skill_points: 150 }],
};

const equipped = (slot: string, name: string, quality: string, level: number, extra: object = {}) => ({
    item: { key: href("/x"), id: 1 },
    slot: { type: slot.toUpperCase().replace(" ", "_"), name: slot },
    quantity: 1,
    quality: { type: quality, name: quality },
    name,
    media: { key: href("/x"), id: 1 },
    item_class: { key: href("/x"), name: "Armor", id: 4 },
    item_subclass: { key: href("/x"), name: "Cloth", id: 1 },
    inventory_type: { type: slot.toUpperCase(), name: slot },
    level: { value: level, display_string: `Item Level ${level}` },
    ...extra,
});

export const equipment = {
    ...self("/equipment"),
    character: characterRef,
    equipped_items: [
        equipped("Head", "Shadow Hood", "UNCOMMON", 24),
        equipped("Chest", "Robes of Arugal", "RARE", 26, {
            enchantments: [{ display_string: "Enchanted: +3 Stamina", enchantment_id: 1, enchantment_slot: { id: 0 } }],
        }),
        equipped("Main Hand", "Staff of Westfall", "RARE", 21),
    ],
};

const rating = (value: number) => ({ rating_bonus: 0, value, rating_normalized: 0 });

export const statistics = {
    ...self("/statistics"),
    character: characterRef,
    health: 812,
    power: 1104,
    power_type: { key: href("/x"), name: "Mana", id: 0 },
    speed: { rating_bonus: 0, rating_normalized: 0 },
    strength: { base: 32, effective: 32 },
    agility: { base: 27, effective: 29 },
    intellect: { base: 51, effective: 74 },
    stamina: { base: 42, effective: 61 },
    spirit: { base: 47, effective: 55 },
    melee_crit: rating(3.2),
    melee_haste: rating(0),
    mastery: rating(0),
    bonus_armor: 0,
    lifesteal: rating(0),
    versatility: 0,
    versatility_damage_done_bonus: 0,
    versatility_healing_done_bonus: 0,
    versatility_damage_taken_bonus: 0,
    avoidance: { rating_bonus: 0, rating_normalized: 0 },
    attack_power: 22,
    main_hand_damage_min: 31.4,
    main_hand_damage_max: 48.2,
    main_hand_speed: 3.1,
    main_hand_dps: 12.84,
    off_hand_damage_min: 0,
    off_hand_damage_max: 0,
    off_hand_speed: 0,
    off_hand_dps: 0,
    spell_power: 18,
    spell_penetration: 0,
    spell_crit: rating(4.51),
    mana_regen: 21,
    mana_regen_combat: 6,
    armor: { base: 54, effective: 210 },
    dodge: rating(3.4),
    parry: rating(0),
    block: rating(0),
    ranged_crit: rating(3.2),
    ranged_haste: rating(0),
    spell_haste: rating(0),
    shadow_resistance: { base: 0, effective: 10 },
    fire_resistance: { base: 0, effective: 0 },
};

export const reputations = {
    ...self("/reputations"),
    character: characterRef,
    reputations: [
        { faction: { key: href("/x"), name: "Orgrimmar", id: 76 }, standing: { raw: 4500, value: 1500, max: 6000, tier: 4, name: "Friendly" } },
        { faction: { key: href("/x"), name: "Undercity", id: 68 }, standing: { raw: 900, value: 900, max: 3000, tier: 3, name: "Neutral" } },
    ],
};

export const guild = {
    ...self("/data/wow/guild/burning-legion"),
    id: 77,
    name: "Burning Legion",
    slug: "burning-legion",
    faction: { type: "HORDE", name: "Horde" },
    ruleset: { key: href("/data/wow/ruleset/15"), name: "Roleplay PvP", id: 15 },
    member_count: 45,
    created_timestamp: 1_793_900_000_000,
    name_search: "BURNING LEGION",
};

const CLASSES: [number, string][] = [[1, "Warrior"], [3, "Hunter"], [4, "Rogue"], [5, "Priest"], [7, "Shaman"], [8, "Mage"], [9, "Warlock"], [11, "Druid"]];
const RACES: [number, string][] = [[2, "Orc"], [5, "Undead"], [6, "Tauren"], [8, "Troll"]];

const member = (name: string, surname: string, level: number, classId: number, raceId: number, rank: number) => ({
    character: {
        key: href(`/profile/wow/character/${name}-${surname}`.toLowerCase()),
        name,
        surname,
        id: level * 1000 + rank,
        slug: `${name}-${surname}`.toLowerCase(),
        level,
        playable_class: { key: href("/x"), id: classId },
        playable_race: { key: href("/x"), id: raceId },
        faction: { type: "HORDE" },
    },
    rank,
});

export const roster = {
    ...self("/data/wow/guild/burning-legion/roster"),
    guild: { key: href("/x"), name: "Burning Legion", id: 77, faction: { type: "HORDE", name: "Horde" }, slug: "burning-legion" },
    members: [
        member("Grom", "Hellscream", 31, 1, 2, 0),
        member("Chaos", "Chris", 24, 9, 2, 1),
        // Enough filler members to need more than two roster pages.
        ...Array.from({ length: 43 }, (_, index) => {
            const [classId] = CLASSES[index % CLASSES.length]!;
            const [raceId] = RACES[index % RACES.length]!;
            return member(`Grunt${String.fromCharCode(65 + (index % 26))}`, `Number${index}`, 5 + (index % 25), classId, raceId, 2 + (index % 4));
        }),
    ],
};

const item = (id: number, name: string, quality: string, extra: object = {}) => ({
    ...self(`/data/wow/item/${id}`),
    id,
    name,
    quality: { type: quality, name: quality[0] + quality.slice(1).toLowerCase() },
    level: 10,
    required_level: 0,
    media: { key: href("/x"), id },
    item_class: { key: href("/x"), name: "Tradeskill", id: 7 },
    item_subclass: { key: href("/x"), name: "Cloth", id: 5 },
    inventory_type: { type: "NON_EQUIP", name: "Non-equippable" },
    purchase_price: 220,
    sell_price: 55,
    max_count: 200,
    is_equippable: false,
    is_stackable: true,
    purchase_quantity: 1,
    preview_item: {
        item: { key: href("/x"), id },
        quality: { type: quality, name: quality },
        name,
        media: { key: href("/x"), id },
        item_class: { key: href("/x"), name: "Tradeskill", id: 7 },
        item_subclass: { key: href("/x"), name: "Cloth", id: 5 },
        inventory_type: { type: "NON_EQUIP", name: "Non-equippable" },
    },
    ...extra,
});

export const LINEN = 2589;
export const WOOL = 2592;
/** On the auction house, but missing from Forever's item data: only Retail knows it. */
export const BRAWLER_GLOVES = 720;

const FOREVER_ITEMS = new Map([[LINEN, item(LINEN, "Linen Cloth", "COMMON")], [WOOL, item(WOOL, "Wool Cloth", "COMMON")]]);
const RETAIL_ITEMS = new Map([
    [LINEN, item(LINEN, "Linen Cloth", "COMMON")],
    [BRAWLER_GLOVES, item(BRAWLER_GLOVES, "Brawler Gloves", "UNCOMMON", {
        inventory_type: { type: "HAND", name: "Hands" },
        item_class: { key: href("/x"), name: "Armor", id: 4 },
        item_subclass: { key: href("/x"), name: "Leather", id: 2 },
        is_stackable: false,
    })],
]);

const searchResult = (items: Map<number, ReturnType<typeof item>>, parameters: { searchFields?: Record<string | symbol, string | number> }) => {
    const query = String(Object.values(parameters.searchFields ?? {})[0] ?? "").toLowerCase();
    const results = [...items.values()]
        .filter((entry) => entry.name.toLowerCase().includes(query))
        .map((entry) => ({ key: href(`/data/wow/item/${entry.id}`), data: { id: entry.id, name: { en_US: entry.name }, quality: { type: entry.quality.type } } }));
    return { page: 1, pageSize: results.length, maxPageSize: 100, pageCount: 1, results };
};

const itemEndpoints = (items: Map<number, ReturnType<typeof item>>) => ({
    item: async (id: number) => {
        const found = items.get(id);
        if (!found) throw notFound();
        return found;
    },
    itemMedia: async (id: number) => {
        if (!items.has(id)) throw notFound();
        return { ...self(`/data/wow/media/item/${id}`), id, assets: [{ key: "icon", value: `https://render.worldofwarcraft.com/us/icons/56/item_${id}.jpg` }] };
    },
    searchItem: async (parameters: { searchFields?: Record<string | symbol, string | number> }) => searchResult(items, parameters),
});

const HOUSES = [
    { key: href("/x"), name: "Alliance Auction House", id: 110 },
    { key: href("/x"), name: "Horde Auction House", id: 111 },
    { key: href("/x"), name: "Horde Auction House", id: 112 },
    { key: href("/x"), name: "Blackwater Auction House", id: 113 },
    { key: href("/x"), name: "Horde Auction House", id: 114 },
];

export interface FakeApi {
    forever: ForeverApi & AuctionApi;
    retail: RetailApi;
    /** How often each endpoint was called. */
    calls: Record<string, number>;
    /** Flip to make the character API return 404, as for a character below level 10. */
    state: { characterExists: boolean; mediaExists: boolean; brokenHouses: Set<number> };
}

export function fakeApi(): FakeApi {
    const calls: Record<string, number> = {};
    const state = { characterExists: true, mediaExists: true, brokenHouses: new Set<number>() };
    const isChris = (name: string, surname: string) => `${name}-${surname}`.toLowerCase() === "chaos-chris";
    const forChris = <T>(value: T) => async (name: string, surname: string) => {
        if (!state.characterExists || !isChris(name, surname)) throw notFound();
        return value;
    };

    const endpoints = {
        characterProfile: forChris(profile),
        characterMedia: async (name: string, surname: string) => {
            if (!state.mediaExists) throw notFound();
            return forChris(media)(name, surname);
        },
        characterEquipments: forChris(equipment),
        characterStatistics: forChris(statistics),
        characterSpecializations: forChris(specializations),
        characterProfessions: forChris(professions),
        characterReputations: forChris(reputations),
        characterPvpSummary: forChris(pvp),
        guild: async (slug: string) => {
            if (slug !== "burning-legion") throw notFound();
            return guild;
        },
        guildRoster: async (slug: string) => {
            if (slug !== "burning-legion") throw notFound();
            return roster;
        },
        playableClasses: async () => ({ ...self("/x"), classes: CLASSES.map(([id, name]) => ({ key: href("/x"), name, id })) }),
        playableRaces: async () => ({ ...self("/x"), races: RACES.map(([id, name]) => ({ key: href("/x"), name, id })) }),
        rulesets: async () => ({ ...self("/x"), rulesets: [1, 2, 3, 15].map((id) => ({ key: href(`/data/wow/ruleset/${id}`), id })) }),
        ruleset: async (id: number) => ({
            ...self(`/data/wow/ruleset/${id}`),
            id,
            name: ({ 1: "PvP", 2: "Normal", 3: "Roleplay", 15: "Roleplay PvP" } as Record<number, string>)[id] ?? "?",
            auctions: href(`/data/wow/ruleset/${id}/auctions/`),
            status: id === 3 ? { type: "DOWN", name: "Down" } : { type: "UP", name: "Up" },
        }),
        ...itemEndpoints(FOREVER_ITEMS),
        auctionHouses: async () => ({ ...self("/x"), auctions: HOUSES }),
        auctionHouse: async (_ruleset: number, houseId: number) => {
            if (state.brokenHouses.has(houseId)) throw new errors.APIError("Bad Gateway", 502, "");
            const house = HOUSES.find((entry) => entry.id === houseId);
            if (!house) throw notFound();
            const base = { ...self("/x"), id: houseId, name: house.name, commodities: href("/x"), ruleset: href("/x") };
            // House 112 is empty: the API then leaves the `auctions` field out.
            if (houseId === 112) return base;
            return {
                ...base,
                auctions: [
                    // A stack of 20 for 40s buyout: 2s each.
                    { id: 1, item: { id: LINEN }, buyout: 4000, bid: 2000, quantity: 20, time_left: "LONG" },
                    { id: 2, item: { id: LINEN }, buyout: 50 + houseId, quantity: 1, time_left: "SHORT" },
                    { id: 3, item: { id: BRAWLER_GLOVES }, bid: 900, quantity: 1, time_left: "MEDIUM" },
                ],
            };
        },
        auctionHouseCommodities: async (_ruleset: number, houseId: number) => {
            if (houseId === 112 || houseId === 114) throw notFound();
            return { ...self("/x"), auctions: [{ id: 9, item: { id: WOOL }, quantity: 400, unit_price: 310, time_left: "LONG" }] };
        },
    };

    const counted = Object.fromEntries(
        Object.entries(endpoints).map(([name, fn]) => [
            name,
            (...args: unknown[]) => {
                calls[name] = (calls[name] ?? 0) + 1;
                return (fn as (...args: unknown[]) => unknown)(...args);
            },
        ]),
    );
    return {
        forever: counted as unknown as ForeverApi & AuctionApi,
        retail: itemEndpoints(RETAIL_ITEMS) as unknown as RetailApi,
        calls,
        state,
    };
}

export const config: Config = {
    discordToken: "test",
    blizzard: { clientId: "id", clientSecret: "secret", region: "us", locale: "en_US" },
    defaultGuild: "Burning Legion",
    defaultFaction: "horde",
    rulesetId: 15,
    auctionMaxAgeMinutes: 60,
    auctionWarmup: false,
};

export function fakeContext(api: FakeApi = fakeApi(), overrides: Partial<Config> = {}): BotContext {
    const merged = { ...config, ...overrides };
    return {
        config: merged,
        claims: new ClaimStore(),
        forever: new ForeverService(api.forever, api.retail, "en_US"),
        auctions: new AuctionService(api.forever, {
            rulesetId: merged.rulesetId,
            houseIds: merged.auctionHouseIds,
            maxAgeMs: merged.auctionMaxAgeMinutes * 60_000,
        }),
    };
}
