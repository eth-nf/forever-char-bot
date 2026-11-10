/**
 * A small in-memory cache with a time-to-live per entry. Concurrent loads of the same key share one request, so a
 * burst of slash commands for the same character costs a single API call.
 */
export class TtlCache<V> {
    readonly #ttlMs: number;
    readonly #maxEntries: number;
    readonly #entries = new Map<string, { value: V; expires: number }>();
    readonly #inflight = new Map<string, Promise<V>>();

    constructor(ttlMs: number, maxEntries = 1000) {
        this.#ttlMs = ttlMs;
        this.#maxEntries = maxEntries;
    }

    /** Returns the cached value if it is still fresh. */
    peek(key: string): V | undefined {
        const hit = this.#entries.get(key);
        return hit && hit.expires > Date.now() ? hit.value : undefined;
    }

    async get(key: string, load: () => Promise<V>): Promise<V> {
        const cached = this.peek(key);
        if (cached !== undefined) return cached;

        const pending = this.#inflight.get(key);
        if (pending) return pending;

        const request = load()
            .then((value) => {
                this.#entries.delete(key);
                this.#entries.set(key, { value, expires: Date.now() + this.#ttlMs });
                // Maps iterate in insertion order, so the first key is the oldest.
                while (this.#entries.size > this.#maxEntries) {
                    const oldest = this.#entries.keys().next().value;
                    if (oldest === undefined) break;
                    this.#entries.delete(oldest);
                }
                return value;
            })
            .finally(() => this.#inflight.delete(key));
        this.#inflight.set(key, request);
        return request;
    }
}

/** Runs `fn` over `items` with at most `limit` running at once, keeping the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index] as T);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
