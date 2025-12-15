
// TODO: Wrap for Firefox to achieve same API

export function saveSyncValue(key, value) {
  return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [key]: value }, function () {
          resolve();
      });
  });
}

export function getSyncValue(key) {
  return new Promise((resolve, reject) => {
      chrome.storage.sync.get([key], function (result) {
          resolve(result[key]);
      });
  });
}

export function toSet(key) {
  return new Promise(resolve => {
      resolve(new Set(key));
  });
}