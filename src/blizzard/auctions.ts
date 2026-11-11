import type { WowForeverApi } from "@pinta365/blizzard_api";
import type { AuctionListing, commodity as Commodity } from "@pinta365/blizzard_api/wow";
import { mapLimit, TtlCache } from "../util/cache.ts";
import type { AuctionFeed, Fetched } from "./auctionFeed.ts";
import { isNotFound } from "./service.ts";

/** The house index comes through the library; the listings through the feed, which can ask for changes only. */
export type AuctionApi = Pick<WowForeverApi, "auctionHouses"> & AuctionFeed;

export type HouseFaction = "alliance" | "horde" | "neutral";

export interface HouseRef {
    id: number;
    name: string;
    faction: HouseFaction;
}

/** What one auction house has of one item. Prices are in copper, per single item. */
export interface ItemPrice {
    /** Lowest buyout per item. Absent when every listing is bid-only. */
    minBuyout?: number;
    /** Lowest current bid per item, among listings that have one. */
    minBid?: number;
    /** Total number of items across all listings. */
    quantity: number;
    listings: number;
}

export interface HouseSnapshot {
    house: HouseRef;
    /** When Blizzard last updated this house's data. When it doesn't say, when the bot downloaded it. */
    updatedAt: number;
    /** When the bot last asked Blizzard for newer data. */
    checkedAt: number;
    items: Map<number, ItemPrice>;
    listings: number;
}

export interface PriceRow {
    house: HouseRef;
    /** When Blizzard last updated the house's data. */
    updatedAt: number;
    /** Absent when the house has no listings of the item. */
    price?: ItemPrice;
}

export interface PriceResult {
    rows: PriceRow[];
    /** Houses whose data could not be loaded. */
    failed: HouseRef[];
}

export function houseFaction(name: string): HouseFaction {
    if (/alliance/i.test(name)) return "alliance";
    if (/horde/i.test(name)) return "horde";
    return "neutral";
}

/**
 * Reduces an auction house's listings to one price entry per item. A house can hold 50,000-70,000 listings (about
 * 9 MB of JSON), so the raw response is dropped after this and only the per-item summary is kept in memory.
 */
export function aggregateListings(
    auctions: readonly AuctionListing[] = [],
    commodities: readonly Commodity[] = [],
): Map<number, ItemPrice> {
    const items = new Map<number, ItemPrice>();
    const add = (itemId: number, quantity: number, buyout?: number, bid?: number) => {
        let entry = items.get(itemId);
        if (!entry) items.set(itemId, (entry = { quantity: 0, listings: 0 }));
        entry.quantity += quantity;
        entry.listings += 1;
        if (buyout !== undefined && (entry.minBuyout === undefined || buyout < entry.minBuyout)) entry.minBuyout = buyout;
        if (bid !== undefined && (entry.minBid === undefined || bid < entry.minBid)) entry.minBid = bid;
    };

    for (const auction of auctions) {
        // A listing's buyout and bid are for the whole stack, as in Classic Era.
        const quantity = Math.max(1, auction.quantity ?? 1);
        const perItem = (total?: number) => (total && total > 0 ? Math.ceil(total / quantity) : undefined);
        add(auction.item.id, quantity, perItem(auction.buyout), perItem(auction.bid));
    }
    for (const listing of commodities) {
        add(listing.item.id, Math.max(1, listing.quantity ?? 1), listing.unit_price > 0 ? listing.unit_price : undefined);
    }
    return items;
}

const lower = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));

/** Combines two per-item summaries, as if their listings had been aggregated together. */
export function mergeItemPrices(a: Map<number, ItemPrice>, b: Map<number, ItemPrice>): Map<number, ItemPrice> {
    const merged = new Map<number, ItemPrice>();
    for (const map of [a, b]) {
        for (const [id, price] of map) {
            const seen = merged.get(id);
            if (!seen) {
                merged.set(id, { ...price });
                continue;
            }
            seen.quantity += price.quantity;
            seen.listings += price.listings;
            const minBuyout = lower(seen.minBuyout, price.minBuyout);
            const minBid = lower(seen.minBid, price.minBid);
            if (minBuyout !== undefined) seen.minBuyout = minBuyout;
            if (minBid !== undefined) seen.minBid = minBid;
        }
    }
    return merged;
}

/** One of a house's two listing endpoints, as last downloaded. */
interface Part {
    items: Map<number, ItemPrice>;
    listings: number;
    lastModified?: number;
}

export interface AuctionServiceOptions {
    /** Any valid ruleset ID. Every ruleset of a region currently lists the same houses with the same auctions. */
    rulesetId: number;
    /** Limits the service to these houses. */
    houseIds?: number[];
    /** How often to ask Blizzard whether a house has new data. */
    checkMs: number;
}

/**
 * Auction house prices. A house is downloaded the first time it's needed, and from then on checked for new data
 * every `checkMs`: Blizzard updates it about once an hour, and a check that finds nothing new costs almost nothing.
 * Lookups never wait for a check; they get the newest data the bot has.
 */
export class AuctionService {
    readonly #api: AuctionApi;
    readonly #options: AuctionServiceOptions;
    readonly #houses = new TtlCache<HouseRef[]>(6 * 60 * 60_000);
    readonly #snapshots = new Map<number, HouseSnapshot>();
    readonly #parts = new Map<number, { auctions: Part; commodities: Part }>();
    readonly #loading = new Map<number, Promise<HouseSnapshot>>();
    #timer?: NodeJS.Timeout;

    constructor(api: AuctionApi, options: AuctionServiceOptions) {
        this.#api = api;
        this.#options = options;
    }

    /** The auction houses, limited to the configured IDs if any. */
    houses(): Promise<HouseRef[]> {
        return this.#houses.get("index", async () => {
            const index = await this.#api.auctionHouses(this.#options.rulesetId);
            const only = this.#options.houseIds;
            return index.auctions
                .filter((house) => !only || only.includes(house.id))
                .map((house) => ({ id: house.id, name: house.name, faction: houseFaction(house.name) }))
                .sort((a, b) => a.id - b.id);
        });
    }

    /** The houses a player of `faction` can use: their own and the neutral ones. Every house when no faction is given. */
    async housesFor(faction?: "alliance" | "horde"): Promise<HouseRef[]> {
        const houses = await this.houses();
        const wanted = houses.filter((house) => !faction || house.faction === faction || house.faction === "neutral");
        const order: HouseFaction[] = ["horde", "alliance", "neutral"];
        return wanted.sort((a, b) => order.indexOf(a.faction) - order.indexOf(b.faction) || a.id - b.id);
    }

    /** The loaded snapshot of a house, however old, if there is one. */
    loaded(houseId: number): HouseSnapshot | undefined {
        return this.#snapshots.get(houseId);
    }

    /**
     * The house's newest snapshot. The first call downloads it; later calls return at once, and start a check in the
     * background if the last one is more than `checkMs` ago (when the polling isn't running, or has stalled).
     */
    snapshot(house: HouseRef): Promise<HouseSnapshot> {
        const current = this.#snapshots.get(house.id);
        if (!current) return this.#refresh(house);
        if (Date.now() - current.checkedAt >= this.#options.checkMs) {
            this.#refresh(house).catch((error) => console.warn(`[auctions] checking house ${house.id} failed:`, error.message));
        }
        return Promise.resolve(current);
    }

    /** Asks Blizzard for anything newer than what the bot has, and updates the snapshot if there is. */
    #refresh(house: HouseRef): Promise<HouseSnapshot> {
        const pending = this.#loading.get(house.id);
        if (pending) return pending;

        const load = (async () => {
            const { rulesetId } = this.#options;
            const previous = this.#parts.get(house.id);
            const [auctions, commodities] = await Promise.all([
                this.#api.auctions(rulesetId, house.id, previous?.auctions.lastModified),
                this.#api
                    .commodities(rulesetId, house.id, previous?.commodities.lastModified)
                    .catch((error): Fetched<Commodity> | undefined => {
                        // Some houses have no commodities endpoint: treat that as empty, and later as unchanged.
                        if (isNotFound(error)) return previous ? undefined : { listings: [] };
                        throw error;
                    }),
            ]);

            const now = Date.now();
            const current = this.#snapshots.get(house.id);
            if (current && previous && !auctions && !commodities) {
                current.checkedAt = now;
                return current;
            }

            const toPart = (fetched: Fetched<AuctionListing> | Fetched<Commodity>, kind: "auctions" | "commodities"): Part => ({
                items: kind === "auctions"
                    ? aggregateListings(fetched.listings as AuctionListing[])
                    : aggregateListings(undefined, fetched.listings as Commodity[]),
                listings: fetched.listings.length,
                lastModified: fetched.lastModified,
            });
            // A part Blizzard reported unchanged keeps what the bot already has.
            const empty: Part = { items: new Map(), listings: 0 };
            const parts = {
                auctions: auctions ? toPart(auctions, "auctions") : (previous?.auctions ?? empty),
                commodities: commodities ? toPart(commodities, "commodities") : (previous?.commodities ?? empty),
            };
            this.#parts.set(house.id, parts);

            const stamps = [parts.auctions.lastModified, parts.commodities.lastModified].filter((stamp) => stamp !== undefined);
            const snapshot: HouseSnapshot = {
                house,
                updatedAt: stamps.length ? Math.max(...stamps) : now,
                checkedAt: now,
                items: mergeItemPrices(parts.auctions.items, parts.commodities.items),
                listings: parts.auctions.listings + parts.commodities.listings,
            };
            this.#snapshots.set(house.id, snapshot);
            return snapshot;
        })().finally(() => this.#loading.delete(house.id));

        this.#loading.set(house.id, load);
        return load;
    }

    /** Loads the given houses' snapshots, two at a time: the responses are large. */
    async load(houses: readonly HouseRef[]): Promise<{ snapshots: HouseSnapshot[]; failed: HouseRef[] }> {
        const failed: HouseRef[] = [];
        const results = await mapLimit(houses, 2, async (house) => {
            try {
                return await this.snapshot(house);
            } catch (error) {
                console.warn(`[auctions] loading house ${house.id} failed:`, (error as Error).message);
                failed.push(house);
                return undefined;
            }
        });
        return { snapshots: results.filter((snapshot) => snapshot !== undefined), failed };
    }

    /** Checks every loaded house for new data. Returns the houses that had some. */
    async checkAll(): Promise<HouseRef[]> {
        const houses = [...this.#snapshots.values()].map((snapshot) => snapshot.house);
        const updated: HouseRef[] = [];
        await mapLimit(houses, 2, async (house) => {
            const before = this.#snapshots.get(house.id);
            try {
                const after = await this.#refresh(house);
                if (after !== before) updated.push(house);
            } catch (error) {
                console.warn(`[auctions] checking house ${house.id} failed:`, (error as Error).message);
            }
        });
        return updated;
    }

    /** Checks the loaded houses every `checkMs` until stopped. */
    startPolling(onUpdate?: (houses: HouseRef[]) => void): void {
        this.stopPolling();
        this.#timer = setInterval(() => {
            this.checkAll().then((houses) => houses.length && onUpdate?.(houses));
        }, this.#options.checkMs);
        // The timer alone shouldn't keep the process running.
        this.#timer.unref();
    }

    stopPolling(): void {
        clearInterval(this.#timer);
        this.#timer = undefined;
    }

    /** What each house a player of `faction` can use has of the item. */
    async prices(itemId: number, faction?: "alliance" | "horde"): Promise<PriceResult> {
        const { snapshots, failed } = await this.load(await this.housesFor(faction));
        const rows = snapshots.map((snapshot) => ({
            house: snapshot.house,
            updatedAt: snapshot.updatedAt,
            price: snapshot.items.get(itemId),
        }));
        return { rows, failed };
    }

    /**
     * Whether any loaded snapshot lists the item, or undefined when nothing is loaded yet. Used to put items that are
     * actually for sale first in autocomplete, without waiting for a request.
     */
    isListed(itemId: number): boolean | undefined {
        if (this.#snapshots.size === 0) return undefined;
        for (const snapshot of this.#snapshots.values()) {
            if (snapshot.items.has(itemId)) return true;
        }
        return false;
    }
}
