
// TODO: Wrap for Firefox to achieve same API

function saveStorageValue(key, value) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set({ [key]: value }, function () {
            resolve();
        });
    });
}

function getStorageValue(key) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get([key], function (result) {
            resolve(result[key]);
        });
    });
}

function toSet(key) {
    return new Promise(resolve => {
        resolve(new Set(key));
    });
}