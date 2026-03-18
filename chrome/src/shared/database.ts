// NOTE: To inspect the IDB in Chromium-based browsers, go to an extension-page (e.g. options.html) and to the DevTools tab there (service worker does not show the IDB)
// see https://groups.google.com/a/chromium.org/g/chromium-extensions/c/iMmV93LyNjI

export const DOMAIN = "domain" as const;
export const MAIN_DOMAIN = "mainDomain" as const;
export const SCION_ENABLED = "scionEnabled" as const;

export type RequestSchema = {
    [DOMAIN]: string;
    [MAIN_DOMAIN]: string;
    [SCION_ENABLED]: boolean;
};

/**
 * Extends the {@link RequestSchema} by the {@link key} and {@link lastAccessed} properties.
 */
type RequestEntryInternal = RequestSchema & {
    key: string;
    lastAccessed: number;
};

const DB_NAME = "scion-cache-db";
const DB_VERSION = 1;

const STORE_ENTRIES = "entries";

const INDEX_LAST_ACCESSED = "by_lastAccessed";
const INDEX_DOMAIN = "by_domain";

const MAX_ENTRIES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES - 500; // subtracting some buffer
const EVICT_COUNT = 100; // arbitrary number that results in eviction process taking ~15ms
/**
 * Represents 1 week.
 */
const MAX_TIME_ALIVE = 7 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Returns all entries stored in the DB.
 *
 * Note: This operation is slow (~1000ms for a DB with 30k entries). Use it appropriately.
 */
export async function getRequestsInDB(): Promise<RequestSchema[]> {
    const db = await openDB();

    const transaction = db.transaction(STORE_ENTRIES, "readonly");
    const store = transaction.objectStore(STORE_ENTRIES);
    const internalResult = await requestToPromise(store.getAll()) as RequestEntryInternal[];
    return internalResult.map(internal => {
        return {
            [DOMAIN]: internal.domain,
            [MAIN_DOMAIN]: internal.mainDomain,
            [SCION_ENABLED]: internal.scionEnabled,
        } as RequestSchema;
    });
}

/**
 * Adds or updates an entry in the DB.
 *
 * The {@link DOMAIN} and {@link MAIN_DOMAIN} are used
 * as the key in the DB; if an entry already exists with this key, the {@link SCION_ENABLED} value is
 * overwritten and {@link RequestEntryInternal.lastAccessed} is updated.
 */
export async function addOrUpdateRequestInDB(entry: RequestSchema): Promise<void> {
    const db = await openDB();
    const key = getKey(entry.domain, entry.mainDomain);

    const transaction = db.transaction([STORE_ENTRIES], "readwrite");
    const store = transaction.objectStore(STORE_ENTRIES);

    const newEntry: RequestEntryInternal = {
        ...entry,
        key,
        lastAccessed: now(),
    };

    const addOrUpdateRequest = store.put(newEntry);
    await requestToPromise(addOrUpdateRequest);

    const count = await getEntryCount(store);
    if (count > MAX_ENTRIES) {
        await evictLRU(store, EVICT_COUNT);
    }

    await transactionDone(transaction);
}

/**
 * Finds a returns the first entry that matches the {@link domain}. Returns `null` if no such element
 * was found.
 *
 * This function also updates the {@link RequestEntryInternal.lastAccessed} to the current timestamp,
 * if an element was found.
 */
export async function findRequestInDB(domain: RequestSchema[typeof DOMAIN]): Promise<RequestSchema | null> {
    const db = await openDB();
    const transaction = db.transaction(STORE_ENTRIES, "readwrite");
    const store = transaction.objectStore(STORE_ENTRIES);
    const index = store.index(INDEX_DOMAIN);

    // since we only need a single entry that matches the `domain` and a secondary index
    // exists on the domain, it suffices to read from the cursor
    const req = index.openCursor(IDBKeyRange.only(domain));
    const entry = await new Promise<RequestEntryInternal | null>(
        (resolve, reject) => {
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) {
                    resolve(null);
                    return;
                }
                resolve(cursor.value as RequestEntryInternal);
            };
            req.onerror = () => reject(req.error);
        }
    );

    // no entry was found that matched the requested `domain`, return null in this case
    if (!entry) {
        await transactionDone(transaction);
        return null;
    }

    // update the timestamp, as this entry was requested
    entry.lastAccessed = now();
    store.put(entry);

    await transactionDone(transaction);

    return {
        [DOMAIN]: entry.domain,
        [MAIN_DOMAIN]: entry.mainDomain,
        [SCION_ENABLED]: entry.scionEnabled,
    };
}

/**
 * Evicts all entries that are older than the timespan defined (in ms) by {@link MAX_TIME_ALIVE}.
 *
 * Note: This function already sets up the DB transaction, the caller therefore mustn't create one.
 */
export async function evictExpiredEntries() {
    const db = await openDB();
    const transaction = db.transaction([STORE_ENTRIES], "readwrite");
    const store = transaction.objectStore(STORE_ENTRIES);

    const index = store.index(INDEX_LAST_ACCESSED);
    const cutoff = Date.now() - MAX_TIME_ALIVE;

    // due to the index, it is sorted ascending by lastAccessed
    const req = index.openCursor();

    await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
            const cursor = req.result as IDBCursorWithValue | null;
            if (!cursor) {
                resolve();
                return;
            }

            const entry = cursor.value as RequestEntryInternal;

            // since the index is sorted, we can stop early
            if (entry.lastAccessed >= cutoff) {
                resolve();
                return;
            }

            store.delete(cursor.primaryKey);
            cursor.continue();
        };

        req.onerror = () => reject(req.error);
    });

    await transactionDone(transaction);
}

/**
 * Opens or returns the DB and ensures it is up-to-date.
 */
function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;

            const entryStore = db.createObjectStore(STORE_ENTRIES, {
                keyPath: "key",
            });

            entryStore.createIndex(
                INDEX_LAST_ACCESSED,
                "lastAccessed",
                {unique: false}
            );

            entryStore.createIndex(
                INDEX_DOMAIN,
                "domain",
                {unique: false}
            );
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    return dbPromise;
}

/**
 * Performs the eviction process of the '{@link count}' least recently used items in IDB.
 *
 * Note that this function neither handles opening nor closing of the transaction.
 */
async function evictLRU(store: IDBObjectStore, count: number): Promise<void> {
    const index = store.index(INDEX_LAST_ACCESSED);

    let removed = 0;
    const req = index.openCursor(); // ascending TTL

    await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor || removed >= count) {
                resolve();
                return;
            }

            store.delete(cursor.primaryKey);
            removed++;
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Returns the number of entries stored in the {@link store}.
 *
 * Note: This method of retrieving the total number of items might be slow for large stores. Alternatives
 * such as keeping track of the number of items in a separate store could be considered if speed is crucial,
 * though they introduce an additional point of failure - the reason why such an alternative was not implemented
 * here.
 */
async function getEntryCount(store: IDBObjectStore): Promise<number> {
    const countRequest = store.count();
    return await requestToPromise(countRequest);
}

/**
 * Returns the key formed by the {@link domain} and {@link mainDomain}.
 */
function getKey(domain: string, mainDomain: string): string {
    return `${domain}|${mainDomain}`;
}

/**
 * Gets current timestamp.
 */
function now(): number {
    return Date.now();
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

/**
 * Converts an {@link IDBRequest} into an await-able {@link Promise}.
 * @example
 * const request = store.put(entry);
 * await requestToPromise(request);
 */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
