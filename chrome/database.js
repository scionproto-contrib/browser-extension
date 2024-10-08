
const database = {
    requests: [],
}

// This is not optimal. The popup and the browser extension have different local/session storages
// So we need to use this sync storage which is limited to 8K and which is slow... 
// Until now I don't have a nice idea on how to solve this.
// phew...

if (window.database === undefined) {
    window.database = database;
}

function saveStorageValue(key, value) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ [key]: value }, function () {
            resolve();
        });
    });
}

function getStorageValue(key) {
    return new Promise((resolve) => {
        chrome.storage.sync.get([key], function (result) {
            resolve(result[key]);
        });
    });
}

const load = async () => {
    const str = await getStorageValue("requests");
    if (str && str != "") {
        window.database = JSON.parse(str);
    }
}

const save = async () => {
    await saveStorageValue("requests", JSON.stringify(window.database));
}

function debounce(func, timeout = 500) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

class DatabaseAdapter {

    constructor(table) {
        this.table = table;
    }

    persist = () => {
        return debounce(() => {
            save();
        })
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

        return new Promise(resolve => {
            if (loadFromStorage) {
                load().then(() => {
                    let filteredRequests = window.database[this.table];
                    Object.keys(filter).forEach((key) => {
                        filteredRequests = filteredRequests.filter(r => r[key] === filter[key]);
                    });

                    resolve(filteredRequests);
                })
            } else {
                let filteredRequests = window.database[this.table];
                Object.keys(filter).forEach((key) => {
                    filteredRequests = filteredRequests.filter(r => r[key] === filter[key]);
                });

                resolve(filteredRequests);
            }


        });

    }


    first = (filter) => {
        return new Promise(resolve => {
            // load();
            let filteredRequests = window.database[this.table];
            Object.keys(filter).forEach((key) => {
                filteredRequests = filteredRequests.filter(r => r[key] === filter[key]);
            });
            if (filteredRequests.length > 0) {
                resolve(filteredRequests[0]);
            }

            resolve(null);
        });
    }

    // replaceFilter is an Object that contains properties
    // which are used to filter the list and if there is a match
    // This one will be updated instead of adding a new one
    add = (entry, replaceFilter) => {
        return new Promise(resolve => {
            // load().then(() => {
            // We need to keep the list small for now, since 
            // This storage thing can only handle 8KB...
            while (window.database[this.table].length > 50) {
                window.database[this.table].shift();
            }

            if (replaceFilter) {

                let existingElementIndex = window.database[this.table].findIndex(e => {
                    let match = true;
                    Object.keys(replaceFilter).forEach(key => {
                        // Only one property needs to differ
                        if (e[key] != replaceFilter[key]) {
                            match = false;
                        }
                    });
                    return match;
                });
                if (existingElementIndex >= 0) {
                    let existingElement = {
                        ...window.database[this.table][existingElementIndex],
                        ...entry
                    };
                    window.database[this.table][existingElementIndex] = existingElement;

                } else {
                    window.database[this.table].push(entry);
                }

            } else {
                window.database[this.table].push(entry);
            }


            // save().then(() => {
            const persist = this.persist();
            persist();
            resolve(entry);
            //  });

            // })

        })
    }

    update = (id, newEntry) => {
        return new Promise(resolve => {
            const entryIndex = window.database[this.table].findIndex(r => r.requestId === id);
            const updateEntry = {
                ...window.database[this.table][entryIndex],
                ...newEntry
            };

            window.database[this.table][entryIndex] = updateEntry;
            const persist = this.persist();
            persist();
            resolve(updateEntry);
        })
    }
}

export const getRequestsDatabaseAdapter = () => {
    return new Promise((resolve) => {
        resolve(new DatabaseAdapter("requests"));
    });
}