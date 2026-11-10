import type { WowForeverApi } from "@pinta365/blizzard_api";
import type { AuctionListing, commodity as Commodity } from "@pinta365/blizzard_api/wow";
import { mapLimit, TtlCache } from "../util/cache.ts";
import { isNotFound } from "./service.ts";

export type AuctionApi = Pick<WowForeverApi, "auctionHouses" | "auctionHouse" | "auctionHouseCommodities">;

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
    fetchedAt: number;
    items: Map<number, ItemPrice>;
    listings: number;
}

export interface PriceRow {
    house: HouseRef;
    fetchedAt: number;
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

export interface AuctionServiceOptions {
    /** Any valid ruleset ID. Every ruleset of a region currently lists the same houses with the same auctions. */
    rulesetId: number;
    /** Limits the service to these houses. */
    houseIds?: number[];
    maxAgeMs: number;
}

/**
 * Auction house prices. Snapshots are loaded per house on demand and reused until they are `maxAgeMs` old; after
 * that the old snapshot is still served at once while a new one loads in the background.
 */
export class AuctionService {
    readonly #api: AuctionApi;
    readonly #options: AuctionServiceOptions;
    readonly #houses = new TtlCache<HouseRef[]>(6 * 60 * 60_000);
    readonly #snapshots = new Map<number, HouseSnapshot>();
    readonly #loading = new Map<number, Promise<HouseSnapshot>>();

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

    snapshot(house: HouseRef): Promise<HouseSnapshot> {
        const current = this.#snapshots.get(house.id);
        if (current && Date.now() - current.fetchedAt < this.#options.maxAgeMs) return Promise.resolve(current);

        const refresh = this.#refresh(house);
        if (!current) return refresh;
        refresh.catch((error) => console.warn(`[auctions] refreshing house ${house.id} failed:`, error.message));
        return Promise.resolve(current);
    }

    #refresh(house: HouseRef): Promise<HouseSnapshot> {
        const pending = this.#loading.get(house.id);
        if (pending) return pending;

        const load = (async () => {
            const { rulesetId } = this.#options;
            const auctions = await this.#api.auctionHouse(rulesetId, house.id);
            const commodities = await this.#api.auctionHouseCommodities(rulesetId, house.id).catch((error) => {
                if (isNotFound(error)) return undefined;
                throw error;
            });
            const items = aggregateListings(auctions.auctions, commodities?.auctions);
            const snapshot: HouseSnapshot = {
                house,
                fetchedAt: Date.now(),
                items,
                listings: (auctions.auctions?.length ?? 0) + (commodities?.auctions?.length ?? 0),
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

    /** What each house a player of `faction` can use has of the item. */
    async prices(itemId: number, faction?: "alliance" | "horde"): Promise<PriceResult> {
        const { snapshots, failed } = await this.load(await this.housesFor(faction));
        const rows = snapshots.map((snapshot) => ({
            house: snapshot.house,
            fetchedAt: snapshot.fetchedAt,
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
