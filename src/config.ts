import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Locales, Regions } from "@pinta365/blizzard_api";

export type PlayerFaction = "horde" | "alliance";

export interface Config {
    /** Absent only when loaded with `requireDiscord: false` (the smoke test). */
    discordToken: string;
    /** When set, slash commands are registered to this server only (instant). Otherwise globally (can take up to an hour). */
    discordGuildId?: string;
    blizzard: {
        clientId: string;
        clientSecret: string;
        region: Regions;
        locale: Locales;
    };
    /** The guild used when a guild command is run without a name, and for character name autocomplete. */
    defaultGuild?: string;
    /** Which faction's auction houses `/price` shows by default. */
    defaultFaction?: PlayerFaction;
    /** Ruleset the auction houses are requested through. Any valid ID works: houses are shared across rulesets. */
    rulesetId: number;
    /** Restricts `/price` to these auction house IDs, once you know which ones are yours. */
    auctionHouseIds?: number[];
    /** Auction snapshots older than this are refreshed in the background. */
    auctionMaxAgeMinutes: number;
    /** Load auction data at startup so the first `/price` is fast. */
    auctionWarmup: boolean;
    /** Folder for data the bot has to keep across restarts (character claims). Nothing is saved without it. */
    dataDir?: string;
}

const REGIONS: readonly Regions[] = ["us", "eu", "kr", "tw", "cn"];
const DEFAULT_LOCALE: Record<Regions, Locales> = {
    us: "en_US",
    eu: "en_GB",
    kr: "ko_KR",
    tw: "zh_TW",
    cn: "zh_CN",
};

export class ConfigError extends Error {}

/** Loads `.env` from the project root into `process.env`, if there is one. */
export function loadEnvFile(): void {
    const path = resolve(import.meta.dirname, "..", ".env");
    if (existsSync(path)) process.loadEnvFile(path);
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new ConfigError(`${key} must be a whole number, got "${raw}".`);
    return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: { requireDiscord?: boolean } = {}): Config {
    const requireDiscord = options.requireDiscord ?? true;
    const get = (key: string) => env[key]?.trim() || undefined;

    const missing: string[] = [];
    const need = (key: string) => {
        const value = get(key);
        if (!value) missing.push(key);
        return value ?? "";
    };

    const discordToken = requireDiscord ? need("DISCORD_TOKEN") : (get("DISCORD_TOKEN") ?? "");
    const clientId = need("BLIZZARD_CLIENT_ID");
    const clientSecret = need("BLIZZARD_CLIENT_SECRET");
    if (missing.length) {
        throw new ConfigError(
            `Missing ${missing.join(", ")}. Copy .env.example to .env and fill them in (see README.md).`,
        );
    }

    const region = (get("BLIZZARD_REGION") ?? "us").toLowerCase() as Regions;
    if (!REGIONS.includes(region)) {
        throw new ConfigError(`BLIZZARD_REGION must be one of ${REGIONS.join(", ")}, got "${region}".`);
    }

    const faction = get("DEFAULT_FACTION")?.toLowerCase();
    if (faction && faction !== "horde" && faction !== "alliance") {
        throw new ConfigError(`DEFAULT_FACTION must be "horde" or "alliance", got "${faction}".`);
    }

    const houseIds = get("AH_HOUSE_IDS")
        ?.split(/[\s,]+/)
        .filter(Boolean)
        .map((part) => {
            const id = Number(part);
            if (!Number.isInteger(id)) throw new ConfigError(`AH_HOUSE_IDS must be a comma-separated list of numbers.`);
            return id;
        });

    return {
        discordToken,
        discordGuildId: get("DISCORD_GUILD_ID"),
        blizzard: {
            clientId,
            clientSecret,
            region,
            locale: (get("BLIZZARD_LOCALE") as Locales | undefined) ?? DEFAULT_LOCALE[region],
        },
        defaultGuild: get("DEFAULT_GUILD"),
        defaultFaction: faction as PlayerFaction | undefined,
        rulesetId: int(env, "RULESET_ID", 15),
        auctionHouseIds: houseIds?.length ? houseIds : undefined,
        auctionMaxAgeMinutes: int(env, "AH_MAX_AGE_MINUTES", 60),
        auctionWarmup: (get("AH_WARMUP") ?? "true").toLowerCase() !== "false",
        dataDir: resolve(import.meta.dirname, "..", get("DATA_DIR") ?? "data"),
    };
}
