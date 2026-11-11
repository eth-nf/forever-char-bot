import { errors } from "@pinta365/blizzard_api";
import type { BlizzardClient, Locales, Regions } from "@pinta365/blizzard_api";
import type { AuctionListing, commodity as Commodity } from "@pinta365/blizzard_api/wow";
import type { ForeverAuctionHouseAuctions, ForeverAuctionHouseCommodities } from "@pinta365/blizzard_api/wow-forever";

/** One download of a house's auctions or commodities. */
export interface Fetched<T> {
    listings: T[];
    /** When Blizzard last updated the data (its Last-Modified header), in ms. */
    lastModified?: number;
}

/**
 * Downloads a house's listings. Each call takes the `lastModified` of the copy the bot already has, and resolves to
 * undefined when Blizzard has nothing newer (HTTP 304), which costs a few hundred bytes instead of megabytes.
 */
export interface AuctionFeed {
    auctions(rulesetId: number, houseId: number, since?: number): Promise<Fetched<AuctionListing> | undefined>;
    commodities(rulesetId: number, houseId: number, since?: number): Promise<Fetched<Commodity> | undefined>;
}

/**
 * The auction endpoints over plain HTTP, using the library's access token. The library doesn't expose response
 * headers or send conditional requests, and both are what make checking for new data every few minutes cheap.
 */
export function httpAuctionFeed(
    client: Pick<BlizzardClient, "authenticate">,
    region: Regions,
    locale: Locales,
): AuctionFeed {
    const base = region === "cn" ? "https://gateway.battlenet.com.cn" : `https://${region}.api.blizzard.com`;

    async function get<T>(path: string, since?: number): Promise<{ body: T; lastModified?: number } | undefined> {
        const send = async (freshToken: boolean) => {
            const headers: Record<string, string> = {
                Authorization: `Bearer ${await client.authenticate(freshToken)}`,
                "Battlenet-Namespace": `dynamic-forever-${region}`,
            };
            if (since !== undefined) headers["If-Modified-Since"] = new Date(since).toUTCString();
            return fetch(`${base}${path}?locale=${locale}`, { headers });
        };

        let response = await send(false);
        if (response.status === 401) {
            // The cached token may have been revoked or expired early.
            await response.body?.cancel();
            response = await send(true);
        }
        if (response.status === 304) return undefined;
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new errors.APIError(`${response.status} ${response.statusText}`, response.status, text);
        }
        const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
        return { body: (await response.json()) as T, lastModified: Number.isNaN(lastModified) ? undefined : lastModified };
    }

    const housePath = (rulesetId: number, houseId: number) => `/data/wow/ruleset/${rulesetId}/auctions/${houseId}`;
    return {
        async auctions(rulesetId, houseId, since) {
            const result = await get<ForeverAuctionHouseAuctions>(housePath(rulesetId, houseId), since);
            // An empty house has no `auctions` field at all.
            return result && { listings: result.body.auctions ?? [], lastModified: result.lastModified };
        },
        async commodities(rulesetId, houseId, since) {
            const result = await get<ForeverAuctionHouseCommodities>(`${housePath(rulesetId, houseId)}/commodities`, since);
            return result && { listings: result.body.auctions ?? [], lastModified: result.lastModified };
        },
    };
}
