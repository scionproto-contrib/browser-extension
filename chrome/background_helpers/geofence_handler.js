import {getStorageValue} from "../shared/storage.js";
import {DEFAULT_PROXY_HOST, HTTPS_PROXY_PORT, HTTPS_PROXY_SCHEME} from "./proxy_handler.js";

const proxyPolicyPath = "/policy"

let proxyScheme = HTTPS_PROXY_SCHEME;
export let policyCookie = null;
export let proxyHost = DEFAULT_PROXY_HOST;
export let proxyAddress = `${proxyScheme}://${proxyHost}:${HTTPS_PROXY_PORT}`;

export function resetPolicyCookie() { policyCookie = null; }

export function allowAllgeofence(allowAll) {
    console.log("allowAllgeofence: ", allowAll)

    if (allowAll) {
        let whitelist = []
        whitelist.push("+")
        setPolicy(whitelist)
        return
    }

    getStorageValue('isd_whitelist').then((isdSet) => {
        console.log(isdSet)
        geofence(isdSet);
    });
}

export function geofence(isdList) {
    console.log("geofence: ", isdList)

    let whitelist = []
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
function setPolicy(policy) {
    let sendSetPolicyRequest = () => {
        const url = `${proxyAddress}${proxyPolicyPath}`;
        fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(policy)
        })
            .then(async (res) => {
                const text = await res.text();

                // The fetch operation is complete. This could mean that either the data transfer has been completed successfully or failed.
                console.log("response code to setPolicy:" + res.status);
                console.log("set policy: ", JSON.stringify(policy))
                if (!res.ok) {
                    throw new Error(`PUT ${url} failed: ${res.status} ${res.statusText} — ${text}`);
                }

                chrome.cookies.getAll({name: "caddy-scion-forward-proxy"}, function (cookies) {
                    console.log("all cookies: ", cookies)
                    cookies = cookies.filter((c) => c.domain == proxyHost)
                    if (cookies.length > 1) {
                        console.log("expected at most one cookie")
                        for (const c of cookies) {
                            console.log(c.name, c.value, c.domain)
                        }
                    }

                    if (cookies.length > 0) {
                        policyCookie = cookies[0]
                        console.log("new path policy cookie: ", cookies[0])

                        // when we set the cookie before (function below), the cookie
                        // is set with ".forward-proxy.scion" as domain (probably since we remove the hostOnly [because of the API]).
                        // The incoming cookie is set with "forward-proxy.scion" as domain.
                        // Since it is convoluted to remove one of the cookies, we just set the cookie again
                        // to avoid inconsistencies between the two of them. Otherwise, calls to /path-usage (which carry the cookie)
                        // have been observer to yield incorrect information.

                        // we have to remove some fields that are not allowed to be set
                        // by the API
                        delete policyCookie["hostOnly"];
                        delete policyCookie["session"];
                        policyCookie.url = `${proxyScheme}://${proxyHost}`;
                        chrome.cookies.set(policyCookie)
                    }
                })
            })
            .catch((err) => {
                console.error('PUT failed:', err);
            });
    }

    // this not only clears all cookies but also the proxy auth credentials
    chrome.browsingData.remove({
        "origins": [
            `${proxyScheme}://${proxyHost}`
        ]
    }, {"cookies": true}, () => {
        // as we have just removed all cookie we have to readd it
        if (policyCookie != null) {

            chrome.cookies.set(policyCookie, () => {
                chrome.cookies.get({
                    url: policyCookie.url,
                    name: policyCookie.name
                }, (resultCookie) => {
                    console.log("Stored cookie:", resultCookie);
                });

                sendSetPolicyRequest()
            })
        } else {
            sendSetPolicyRequest()
        }
    })
}