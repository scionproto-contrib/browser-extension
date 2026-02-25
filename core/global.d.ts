import type Browser from "webextension-polyfill";

/**
 * Workaround to get type-support for webextension-polyfill (https://github.com/mozilla/webextension-polyfill) when using ES6 module loader.
 * See https://github.com/Lusito/webextension-polyfill-ts
 */
declare global {
    const browser: Browser.Browser;
}

export {};