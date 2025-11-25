
// TODO: Wrap for Firefox to achieve same API

export function saveStorageValue(key, value) {
  return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [key]: value }, function () {
          resolve();
      });
  });
}

export function getStorageValue(key) {
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