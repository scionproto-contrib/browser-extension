// Copyright 2024 ETH Zurich, Ovgu

import {getStorageValue, saveStorageValue} from "./shared/storage.js";

const root = (typeof globalThis !== 'undefined') ? globalThis : self;

// Initialize shared in-memory DB (works in pages and service worker)
if (!root.database) {
    root.database = { requests: [] };
}

const load = async () => {
    const str = await getStorageValue("requests");
    if (str && str !== "") {
        try {
            root.database = JSON.parse(str);
            // Ensure shape
            if (!root.database.requests) root.database.requests = [];
        } catch {
            // If parse fails, keep current in-memory structure
        }
    }
}

const save = async () => {
    await saveStorageValue("requests", JSON.stringify(root.database));
}

class DatabaseAdapter {

    constructor(table) {
        this.table = table;
    }

    // This part was the reason for missing SCION domain indicators.
    // Here we need to differentiate who is calling
    // The databaseAdapter created from background.js
    // Will be kept in memory all the time, which means we can safely just
    // Write into memory. The persisting to the synced storage
    // Will be debounced to avoid too many writes.
    // The databaseAdapter from the popup.js will be created from scratch
    // every time the popup opens, which means it needs to fetch the
    // resources from storage, by passing loadFromStorage=true
    get = (filter, loadFromStorage) => {
        return new Promise(async resolve => {
            const run = async () => {
                await load();
                let filtered = root.database[this.table] || [];
                Object.keys(filter || {}).forEach((key) => {
                    filtered = filtered.filter(r => r[key] === filter[key]);
                });
                resolve(filtered);
            };

            if (loadFromStorage) {
                load().then(run);
            } else {
                await run();
            }
        });
    }

    first = (filter) => {
        return new Promise(async resolve => {
            await load();
            let filtered = root.database[this.table] || [];
            Object.keys(filter || {}).forEach((key) => {
                filtered = filtered.filter(r => r[key] === filter[key]);
            });
            resolve(filtered.length > 0 ? filtered[0] : null);
        });
    }

    // replaceFilter: if provided, update matching entry instead of pushing a new one
    add = (entry, replaceFilter) => {
        return new Promise(async resolve => {

            // TODO: this works for now, determine whether there is a more efficient way of doing this instead of accessing sync storage for every entry to be added...
            // TODO: but why is this needed, given the load() call in the getRequestsDatabaseAdapter???
            await load();
            // keep list small (sync storage quota)
            const list = root.database[this.table] || (root.database[this.table] = []);
            while (list.length > 50) {
                list.shift();
            }

            if (replaceFilter) {
                const idx = list.findIndex(e => {
                    let match = true;
                    Object.keys(replaceFilter).forEach(key => {
                        if (e[key] !== replaceFilter[key]) match = false;
                    });
                    return match;
                });

                if (idx >= 0) {
                    list[idx] = { ...list[idx], ...entry };
                } else {
                    list.push(entry);
                }
            } else {
                list.push(entry);
            }

            await save()
            resolve(entry);
        });
    }

    update = (requestId, newEntry) => {
        return new Promise(async resolve => {
            await load();
            const list = root.database[this.table] || (root.database[this.table] = []);
            const entryIndex = list.findIndex(r => r.requestId === requestId);
            if (entryIndex >= 0) {
                const updated = { ...list[entryIndex], ...newEntry };
                list[entryIndex] = updated;

                await save()
                resolve(updated);
            } else {
                resolve(null);
            }
        })
    }
}

// using this variable to detect if the service worker got torn down and rebuilt, thus requiring a reload from storage
let currentDbInstance = null;

export const getRequestsDatabaseAdapter = () => {
    if (!currentDbInstance) {
        currentDbInstance = load().catch(() => {});
    }

    return currentDbInstance.then(() => new DatabaseAdapter("requests"));
}