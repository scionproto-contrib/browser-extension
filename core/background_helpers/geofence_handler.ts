import {getSyncValue, ISD_WHITELIST} from "../shared/storage.js";
import {proxyAddress, proxyHost, proxyPolicyPath, proxyScheme} from "./proxy_handler.js";
import type {Cookies} from "webextension-polyfill";

type Cookie = Cookies.Cookie;
type SetDetailsNullable = Cookies.SetDetailsType | null;
type SetDetails = Cookies.SetDetailsType;

export let policyCookie: SetDetailsNullable = null;

export function resetPolicyCookie() {
    policyCookie = null;
}

export function allowAllgeofence(allowAll: boolean) {
    console.log("allowAllgeofence: ", allowAll)

    if (allowAll) {
        let whitelist = []
        whitelist.push("+")
        setPolicy(whitelist)
        return
    }

    getSyncValue(ISD_WHITELIST).then((isdSet) => {
        console.log(isdSet)
        if (isdSet) geofence(isdSet);
    });
}

export function geofence(isdList: string[]) {
    console.log("geofence: ", isdList)

    let whitelist: string[] = []
    for (const isd of isdList) {
        whitelist.push("+ " + isd);
    }
    whitelist.push("-") // deny everything else
    setPolicy(whitelist)
}

// A couple of things happend on a policy change:
// 1. all cookies and cached proxy authorization credentials are deleted
// 2. the Skip proxy is updated with the new policy
// 3. the path policy cookie is globally stored and will be used as proxy authorization from now on
function setPolicy(policy: string[]) {
    let sendSetPolicyRequest = () => {
        const url = `${proxyAddress}${proxyPolicyPath}`;
        fetch(url, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json; charset=utf-8'},
            body: JSON.stringify(policy)
        }).then(async (res: Response) => {
            const text = await res.text();

            // The fetch operation is complete. This could mean that either the data transfer has been completed successfully or failed.
            console.log("response code to setPolicy:" + res.status);
            console.log("set policy: ", JSON.stringify(policy))
            if (!res.ok) {
                throw new Error(`PUT ${url} failed: ${res.status} ${res.statusText} — ${text}`);
            }

            let cookies: Cookie[] = await browser.cookies.getAll({name: "caddy-scion-forward-proxy"});
            console.log("all cookies: ", cookies)
            cookies = cookies.filter((c: Cookie) => c.domain == proxyHost)
            if (cookies.length > 1) {
                console.log("expected at most one cookie")
                for (const c of cookies) {
                    console.log(c.name, c.value, c.domain)

                }
            }

            if (cookies.length > 0) {
                const cookie: Cookie = cookies[0];
                console.log("new path policy cookie: ", cookies[0])

                // when we set the cookie before (function below), the cookie
                // is set with ".forward-proxy.scion" as domain (probably since we remove the hostOnly [because of the API]).
                // The incoming cookie is set with "forward-proxy.scion" as domain.
                // Since it is convoluted to remove one of the cookies, we just set the cookie again
                // to avoid inconsistencies between the two of them. Otherwise, calls to /path-usage (which carry the cookie)
                // have been observer to yield incorrect information.
                let details: SetDetails = policyCookie ??= ({} as SetDetails);
                details.name = cookie.name;
                details.domain = cookie.domain;
                details.value = cookie.value;
                details.httpOnly = cookie.httpOnly;
                details.path = cookie.path;
                details.expirationDate = cookie.expirationDate;
                details.partitionKey = cookie.partitionKey;
                details.sameSite = cookie.sameSite;
                details.secure = cookie.secure;
                details.storeId = cookie.storeId;

                details.url = `${proxyScheme}://${proxyHost}`;
                policyCookie = details;
                await browser.cookies.set(policyCookie);
            }
        }).catch((err) => {
            console.error('PUT failed:', err);
        });
    }

    const hostname = new URL(`${proxyScheme}://${proxyHost}`).hostname;
    // this not only clears all cookies but also the proxy auth credentials
    browser.browsingData.remove(
        {"hostnames": [hostname]},
        {"cookies": true},
    ).then(() => {

        // as we have just removed all cookie we have to readd it
        if (policyCookie != null) {
            browser.cookies.set(policyCookie).then(async () => {
                const resultCookie: Cookie | null = await browser.cookies.get({

                    url: policyCookie!.url,
                    name: policyCookie!.name!,
                });
                console.log("Stored cookie:", resultCookie);

                sendSetPolicyRequest()
            });
        } else {
            sendSetPolicyRequest()
        }
    });
}