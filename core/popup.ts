// Copyright 2024 ETH Zurich, Ovgu
'use strict';


import {getSyncValue, getSyncValues, getTabResources, PER_SITE_STRICT_MODE, PROXY_HOST, PROXY_PORT, PROXY_SCHEME, saveSyncValue, type SyncValueSchema} from "./shared/storage.js";
import {DEFAULT_PROXY_HOST, HTTPS_PROXY_SCHEME, HTTPS_PROXY_PORT, proxyPathUsagePath, proxyHealthCheckPath} from "./background_helpers/proxy_handler.js";
import {safeHostname} from "./shared/utilities.js";

type Tab = chrome.tabs.Tab;
type PerDomainPathUsage = { Domain: string, Path: string[], Strategy: string };
type ProxyPathUsageResponse = PerDomainPathUsage[];

const DEFAULT_PROXY_SCHEME = HTTPS_PROXY_SCHEME;
const DEFAULT_PROXY_PORT = HTTPS_PROXY_PORT;

const toggleRunning = document.getElementById('toggleRunning') as HTMLInputElement;
const checkboxRunning = document.getElementById('checkboxRunning') as HTMLDivElement;
const lineRunning = document.getElementById("lineRunning") as HTMLDivElement;
const scionmode = document.getElementById("scionmode") as HTMLSpanElement;
const mainDomain = document.getElementById("maindomain") as HTMLDivElement;
const pathUsageContainer = document.getElementById("path-usage-container")!;
const scionModePreference = document.getElementById('scionModePreference') as HTMLDivElement;
const domainList = document.getElementById("domainlist") as HTMLDivElement;
const scionsupport = document.getElementById("scionsupport") as HTMLHeadingElement;
const proxyStatusMessage = document.getElementById('proxy-status-message') as HTMLSpanElement;
const proxyHelpLink = document.getElementById('proxy-help-link') as HTMLAnchorElement;
const buttonOptionsButton = document.getElementById('button-options') as HTMLButtonElement;

const asNameMap: Record<string, string> = {
    "88": "Princeton University - CITP",
    "225": "University of Virginia",
    "559": "SWITCH",
    "1140": "SIDN Labs",
    "1349": "British Telecommunications PLC",
    "1888": "Stichting Centrum voor Wiskunde en Informatica",
    "1916": "Rede Nacional de Ensino e Pesquisa - RNP",
    "2546": "NCSR Demokritos",
    "3303": "Swisscom",
    "3786": "LG Uplus Corp.",
    "4158": "City University of Hong Kong",
    "6730": "Sunrise UPC GmbH",
    "8300": "Swisscom (Suisse) SA",
    "8883": "UBS",
    "9025": "SIX Group Services AG",
    "12350": "VTX Services SA",
    "12429": "Swisscom (Suisse) SA",
    "12511": "PostFinance AG",
    "12649": "Banque Pictet & Cie SA",
    "12928": "Banque Cantonale Vaudoise",
    "13030": "Init7",
    "13267": "Zürcher Kantonalbank",
    "13282": "Bank Julius Bär",
    "13283": "Julius Bär",
    "15361": "Union Bancaire Privée, UBP SA",
    "15532": "Raiffeisen Schweiz Genossenschaft",
    "15623": "Cyberlink AG",
    "20965": "GEANT",
    "21047": "Deutsche Bank AG Frankfurt a.M. - Zurich Branch",
    "24951": "EveryWare",
    "25090": "Alpiq AG",
    "25289": "BNP Paribas (Suisse) SA",
    "28928": "Schwyzer Kantonalbank",
    "29641": "Allianz",
    "30870": "Varity (Trans-iX B.V.)",
    "31004": "Schweizerische Bundesbahnen SBB",
    "31097": "Cornèr Banca S.A.",
    "33965": "Litecom AG",
    "35240": "HSBC PB Services (Suisse) SA",
    "39932": "Ergon Informatik AG",
    "41623": "Dukascopy Bank SA",
    "41632": "Glarner Kantonalbank",
    "43577": "Hypothekarbank Lenzburg",
    "44346": "Swissquote Bank SA",
    "46646": "Bottomline Technologies Sàrl",
    "47176": "Gas&Com AG",
    "48038": "Coop Gruppe Genossenschaft",
    "50999": "King Abdullah University of Science and Technology",
    "57676": "Azienda Elettrica Ticinese (AET)",
    "57965": "International Committee of the Red Cross",
    "59414": "Cyberlink AG",
    "59647": "EKT AG",
    "60284": "Axpo WZ-Systems AG",
    "64580": "Frankfurter Bankgesellschaft (Schweiz) AG",
    "196722": "Schweizerische Nationalbank",
    "197312": "Avaloq Sourcing Switzerlang & Liechtenstein SA",
    "200888": "InfoGuard AG",
    "202405": "Liechtensteinische Landesbank Aktiengesellschaft",
    "202908": "LGT Financial Services AG",
    "203311": "NATO Cooperative Cyber Defence Centre of Excellence (CCDCoE)",
    "205755": "Sdnbucks B.V.",
    "206662": "Inventx AG",
    "208305": "Viseca Payment Services AG",
    "208836": "Banca Popolare di Sondrio (Suisse) SA",
    "210018": "Bank CIC (Switzerland) AG",
    "212777": "Schweizerische Mobiliar Versicherungsgesellschaft AG",
    "401500": "Karrier One",
    "2:0:0": "Anapaya Systems AG",
    "2:0:1": "Schweizerische Nationalbank",
    "2:0:2": "SIX Group Services AG",
    "2:0:3": "Zürcher Kantonalbank",
    "2:0:4": "Swisscom (Suisse) SA",
    "2:0:5": "Swisscom (Suisse) SA",
    "2:0:6": "deprecated",
    "2:0:7": "deprecated",
    "2:0:8": "deprecated",
    "2:0:9": "ETH Zurich",
    "2:0:a": "deprecated",
    "2:0:b": "deprecated",
    "2:0:c": "Swiss National Supercomputing Centre",
    "2:0:d": "deprecated",
    "2:0:e": "deprecated",
    "2:0:f": "Anapaya Systems AG",
    "2:0:10": "Anapaya Systems AG",
    "2:0:11": "Anapaya Systems AG",
    "2:0:12": "deprecated",
    "2:0:13": "Anapaya Systems AG",
    "2:0:14": "deprecated",
    "2:0:15": "deprecated",
    "2:0:16": "Eidgenössisches Departement für auswärtige Angelegenheiten",
    "2:0:17": "Axpo WZ-Systems AG",
    "2:0:18": "SEC",
    "2:0:19": "Anapaya Systems AG",
    "2:0:1a": "Anapaya Systems AG",
    "2:0:1b": "Sunrise UPC GmbH",
    "2:0:1c": "Swisscom (Suisse) SA",
    "2:0:1d": "Swisscom (Suisse) SA",
    "2:0:1e": "Swisscom (Suisse) SA",
    "2:0:1f": "Sunrise UPC GmbH",
    "2:0:20": "Proximus Luxembourg S.A.",
    "2:0:21": "Sunrise UPC GmbH",
    "2:0:22": "Sunrise UPC GmbH",
    "2:0:23": "InterCloud SAS",
    "2:0:24": "InterCloud SAS",
    "2:0:25": "InterCloud SAS",
    "2:0:26": "InterCloud SAS",
    "2:0:27": "Cyberlink AG",
    "2:0:28": "Cyberlink AG",
    "2:0:29": "VBS",
    "2:0:2a": "CyberLink",
    "2:0:2b": "Armasuisse",
    "2:0:2c": "Armasuisse",
    "2:0:2d": "Armasuisse",
    "2:0:2e": "Health Info Net AG",
    "2:0:2f": "deprecated",
    "2:0:30": "deprecated",
    "2:0:33": "Health Info Net AG",
    "2:0:34": "BNC",
    "2:0:35": "BRIDGES",
    "2:0:36": "RUAG AG",
    "2:0:37": "UBS",
    "2:0:38": "UBS",
    "2:0:39": "Bottomline",
    "2:0:3a": "Mysten Labs",
    "2:0:3b": "KREONET",
    "2:0:3c": "KREONET",
    "2:0:3d": "KREONET",
    "2:0:3e": "KREONET",
    "2:0:3f": "KREONET",
    "2:0:40": "KREONET",
    "2:0:41": "RUAG AG",
    "2:0:42": "Mysten Labs",
    "2:0:43": "Mysten Labs",
    "2:0:44": "VTX",
    "2:0:45": "VTX",
    "2:0:46": "Swisscom (Suisse) SA",
    "2:0:47": "Mysten",
    "2:0:48": "Equinix",
    "2:0:49": "CybExer Technologies",
    "2:0:4a": "Otto-von-Guericke-Universität Magdeburg",
    "2:0:4b": "Martincoit Networks",
    "2:0:4c": "AWS PoC Anapaya",
    "2:0:4d": "Korea University",
    "2:0:4f": "Infoguard",
    "2:0:50": "Mainstreaming",
    "2:0:51": "InterCloud SAS",
    "2:0:53": "Everyware",
    "2:0:54": "Everyware",
    "2:0:55": "InterCloud SAS",
    "2:0:56": "Armasuisse",
    "2:0:57": "Mysten Labs",
    "2:0:58": "Mysten Labs",
    "2:0:59": "Mysten Labs",
    "2:0:5a": "Mysten Labs",
    "2:0:5b": "Mysten Labs",
    "2:0:5c": "Universidade Federal de Mato Grosso do Sul",
    "2:0:5d": "BIS",
    "2:0:5e": "deprecated",
    "2:0:5f": "deprecated",
    "2:0:60": "deprecated",
    "2:0:61": "deprecated",
    "2:0:63": "smaro GmbH",
    "2:0:64": "Swisscom (Suisse) SA",
    "2:0:65": "HEIG-VD (Haute école d’ingénierie et de gestion du canton de Vaud)",
    "2:0:66": "Kanton Solothurn",
    "2:0:67": "Colt Netherlands",
    "2:0:68": "Colt United Kingdom",
    "2:0:69": "Colt Germany",
    "2:0:6a": "Colt United Kingdom Test AS",
    "2:0:6b": "Colt Germany Test AS",
    "2:0:6c": "Cyberlink AG",
    "2:0:6d": "Cyberlink AG",
    "2:0:6e": "Cyberlink AG",
    "2:0:6f": "Schweizerische Nationalbank",
    "2:0:70": "Anapaya Azure Test AS",
    "2:0:71": "InterCloud SAS",
    "2:0:72": "Anapaya Systems AG",
    "2:0:73": "Anapaya Systems AG",
    "2:0:74": "Anapaya Systems AG",
    "2:0:75": "Anapaya Systems AG",
    "2:0:76": "Axpo WZ-Systems AG",
    "2:0:77": "Mysten Validator",
    "2:0:78": "Mysten Validator",
    "2:0:79": "Mysten Validator",
    "2:0:7a": "Mysten Validator",
    "2:0:7b": "Mysten Validator",
    "2:0:7c": "Mysten Validator",
    "2:0:7d": "Mysten Validator",
    "2:0:7e": "Mysten Validator",
    "2:0:7f": "Mysten Validator",
    "2:0:80": "Mysten Validator",
    "2:0:81": "deprecated",
    "2:0:82": "Anapaya Systems AG",
    "2:0:83": "deprecated",
    "2:0:84": "Secure EFTPOS Network Association",
    "2:0:85": "BIS",
    "2:0:86": "Axpo",
    "2:0:87": "Anapaya Systems AG",
    "2:0:88": "Mysten Validator",
    "2:0:89": "Mysten Validator",
    "2:0:8a": "Mysten Validator",
    "2:0:8b": "Mysten Validator",
    "2:0:8c": "Mysten Validator",
    "2:0:8d": "Mysten Validator",
    "2:0:8e": "Mysten Validator",
    "2:0:8f": "Mysten Validator",
    "2:0:90": "Mysten Validator",
    "2:0:91": "Mysten Validator",
    "2:0:92": "PCB",
    "2:0:96": "Cyberlink AG",
    "2:0:97": "Cyberlink AG",
    "2:0:98": "Worldline Schweiz AG",
    "2:0:99": "Worldline Schweiz AG",
    "2:0:9a": "Sunrise UPC GmbH",
    "2:0:9b": "Schweizerische Nationalbank",
    "2:0:9c": "ETH Zurich",
    "2:0:9d": "Armasuisse",
    "2:0:9e": "eSANITA",
    "2:0:9f": "Anapaya Lab",
    "2:0:a0": "Worldline Schweiz AG",
    "2:0:a1": "Worldline Schweiz AG",
    "2:0:a2": "Swisscard AECS GmbH",
    "2:0:a3": "Samsung electronics",
    "2:0:a4": "Samsung electronics",
    "2:0:a5": "Samsung electronics",
    "2:0:a6": "TWINT AG",
    "2:0:a7": "Anapaya SNAP PoC",
    "2:0:a8": "ETH Zurich Cloudscale",
    "2:0:a9": "HIN Cloudscale RMA Test",
    "2:0:aa": "Anapaya USA",
    "2:0:ab": "Litecom AG",
    "2:0:ac": "Semax AG",
    "2:0:ad": "Semax AG",
    "2:0:ae": "Mysten Labs WorldStream NL Mainnet",
    "2:0:af": "Mysten Labs WorldStream NL Testnet",
    "2:0:b0": "reserved",
    "2:0:b1": "Varity Whitesky",
    "2:0:b2": "Varity Wormerveer",
    "2:0:b3": "reserved",
    "2:0:b4": "reserved",
    "2:0:b5": "reserved",
    "2:0:b6": "reserved",
    "2:0:b7": "reserved",
    "2:0:b8": "reserved",
    "2:0:b9": "reserved",
    "2:0:ba": "reserved",
    "2:0:bb": "reserved",
    "2:0:bc": "reserved",
    "2:0:bd": "reserved",
    "2:0:be": "reserved",
    "2:0:bf": "reserved",
    "2:0:c0": "reserved",
    "2:0:c1": "reserved",
    "2:0:c2": "reserved",
    "2:0:c3": "reserved",
    "2:0:c4": "reserved",
    "2:0:c5": "reserved",
    "2:0:c6": "reserved",
    "2:0:c7": "reserved",
    "2:0:c8": "reserved",
    "2:0:c9": "reserved",
    "2:0:ca": "reserved",
    "2:0:cb": "reserved",
    "2:0:cc": "reserved",
    "2:0:cd": "reserved",
    "2:0:ce": "reserved",
    "2:0:cf": "reserved",
    "2:0:d0": "reserved",
    "2:0:d1": "reserved",
    "2:0:d2": "reserved",
    "2:0:d3": "reserved",
    "2:0:d4": "reserved",
    "2:0:d5": "reserved",
    "2:0:d6": "reserved",
    "2:0:d7": "reserved",
    "2:0:d8": "reserved",
    "2:0:d9": "reserved",
    "2:0:da": "reserved",
    "2:0:db": "reserved",
    "2:0:dc": "reserved",
    "2:0:dd": "reserved",
    "2:0:de": "reserved",
    "2:0:df": "reserved",
    "2:0:e0": "reserved",
    "2:0:e1": "reserved",
    "2:0:e2": "reserved",
    "2:0:e3": "reserved",
    "2:0:e4": "reserved",
    "2:0:e5": "reserved",
    "2:0:e6": "reserved",
    "2:0:e7": "reserved",
    "2:0:e8": "reserved",
    "2:0:e9": "reserved",
    "2:0:ea": "reserved",
    "2:0:eb": "reserved",
    "2:0:ec": "reserved",
    "2:0:ed": "reserved",
    "2:0:ee": "reserved",
    "2:0:ef": "reserved",
    "2:0:f0": "reserved",
    "2:0:f1": "reserved",
    "2:0:f2": "reserved",
    "2:0:f3": "reserved",
    "2:0:f4": "reserved",
    "2:0:f5": "reserved",
    "2:0:f6": "reserved",
    "2:0:f7": "reserved",
    "2:0:f8": "reserved",
    "2:0:f9": "reserved",
    "2:0:fa": "reserved",
    "2:0:fb": "reserved",
    "2:0:fc": "reserved",
    "2:0:fd": "reserved",
    "2:0:fe": "reserved",
    "2:0:ff": "reserved",
    "2:0:100": "reserved",
    "2:0:101": "reserved",
    "2:0:102": "reserved",
    "2:0:103": "reserved",
    "2:0:104": "reserved",
    "2:0:105": "reserved",
    "2:0:106": "reserved",
    "2:0:107": "reserved",
    "2:0:108": "reserved",
    "2:0:109": "reserved",
    "2:0:10a": "reserved",
    "2:0:10b": "reserved",
    "2:0:10c": "reserved",
    "2:0:10d": "reserved",
    "2:0:10e": "reserved",
    "2:0:10f": "reserved",
    "2:0:110": "reserved",
    "2:0:111": "reserved",
    "2:0:112": "reserved",
    "2:0:113": "reserved",
    "2:0:114": "reserved",
    "2:0:115": "reserved",
    "2:0:116": "reserved",
    "2:0:117": "reserved",
    "2:0:118": "reserved",
    "2:0:119": "reserved",
    "2:0:11a": "reserved",
    "2:0:11b": "reserved",
    "2:0:11c": "reserved",
    "2:0:11d": "reserved",
    "2:0:11e": "reserved",
    "2:0:11f": "reserved",
    "2:0:120": "reserved",
    "2:0:121": "reserved",
    "2:0:122": "reserved",
    "2:0:123": "reserved",
    "2:0:124": "reserved",
    "2:0:125": "reserved",
    "2:0:126": "reserved",
    "2:0:127": "reserved",
    "2:0:128": "reserved",
    "2:0:129": "reserved",
    "2:0:12b": "reserved",
    "2:0:12c": "reserved",
    "2:0:12d": "reserved",
    "2:0:12e": "reserved",
    "2:0:12f": "reserved",
    "2:0:130": "Mysten Labs CherryServers LT Mainnet",
    "2:0:131": "Mysten Labs CherryServers LT Testnet",
    "2:0:132": "Mysten Labs OVH FR Mainnet",
    "2:0:133": "Mysten Labs OVH FR Testnet",
    "2:0:134": "Mysten Labs OVH DE Mainnet",
    "2:0:135": "Mysten Labs OVH DE Testnet",
    "2:0:136": "Mysten Labs OVH CA Mainnet",
    "2:0:137": "Mysten Labs OVH CA Testnet",
    "2:0:138": "IKEA AG"
};

let proxyAddress = `${DEFAULT_PROXY_SCHEME}://${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}`


let perSiteStrictMode: SyncValueSchema[typeof PER_SITE_STRICT_MODE] = {};
let popupMainDomain = "";

checkboxRunning.onclick = toggleExtensionRunning;

buttonOptionsButton.addEventListener('click', function () {
    chrome.tabs.create({'url': 'chrome://extensions/?options=' + chrome.runtime.id});
});

getSyncValue(PER_SITE_STRICT_MODE, {}).then((result) => {
    perSiteStrictMode = result;
    loadRequestInfo();
});

document.addEventListener("DOMContentLoaded", () => {
    getSyncValues({
        [PROXY_SCHEME]: DEFAULT_PROXY_SCHEME,
        [PROXY_HOST]: DEFAULT_PROXY_HOST,
        [PROXY_PORT]: DEFAULT_PROXY_PORT,
    }).then((result) => {
        let proxyScheme = result[PROXY_SCHEME];
        let proxyHost = result[PROXY_HOST];
        let proxyPort = result[PROXY_PORT];
        proxyAddress = `${proxyScheme}://${proxyHost}:${proxyPort}`;

        checkProxyStatus();
    });
});

const updatePathUsage = () => {
    pathUsageContainer.innerHTML = "";

    console.log("get path usage")
    fetch(`${proxyAddress}${proxyPathUsagePath}`, {
        method: "GET"
    }).then(response => {
        if (response.status === 200) {
            response.json().then(res => {
                const json = res as ProxyPathUsageResponse;
                console.log(json)
                const startIndex = 2; // The first indices are already used the parent container
                if (!json || json.length === 0) {
                    pathUsageContainer.innerHTML = "<p>No path usage data available\n</p>" + "<p>Try to configure your own policies to have acces to path usage data (under <i>Manage Preferences</i>).</p>";
                }

                json.forEach((pathUsage: PerDomainPathUsage) => {
                    console.log(pathUsage.Domain.split(":")[0])
                    // we only expect one match
                    if (popupMainDomain && pathUsage.Domain.split(":")[0] === popupMainDomain) {
                        let pathUsageChild = newPathUsageChild(pathUsage, startIndex);
                        pathUsageContainer.innerHTML += pathUsageChild;
                    }
                })
                if (pathUsageContainer.innerHTML === "") {
                    pathUsageContainer.innerHTML = "<p>No path usage data available for " + (popupMainDomain || "current domain") + "\n</p>" + "<p>Try to configure your own policies to have acces to path usage data (under <i>Manage Preferences</i>).</p>";
                    return;
                }
            });
        }
    });

};

function checkProxyStatus() {
    proxyStatusMessage.textContent = "Checking proxy status...";
    proxyHelpLink.classList.add('hidden');

    const proxyDetailsContent = document.getElementById('proxy-details-content')!;
    fetch(`${proxyAddress}${proxyHealthCheckPath}`, {
        method: "GET",
        signal: AbortSignal.timeout(2000)
    }).then(response => {
        if (response.status === 200) {

            if (proxyAddress.startsWith('https://')) {
                proxyStatusMessage.textContent = "Connected to proxy via HTTPS";
                proxyStatusMessage.innerHTML += " <span>&#x2705;</span> ";
                proxyHelpLink.classList.add('hidden');
            } else {
                proxyStatusMessage.textContent = "Connected to proxy via HTTP. Check help to connect via HTTPS.";
                proxyStatusMessage.innerHTML += " <span>&#x26A0;</span> ";
                showProxyHelpLink();
            }
            proxyDetailsContent.textContent = `Proxy at ${proxyAddress}`;
        } else {
            // Show error message for non-200 responses
            console.warn("Proxy check failed:", response.status);
            proxyStatusMessage.textContent = "Failed to connect to proxy";
            proxyStatusMessage.innerHTML += " <span>#x274C;</span> ";
            proxyDetailsContent.textContent = `Proxy at ${proxyAddress}`;
            showProxyHelpLink();
        }
    }).catch(error => {
        // Handle network errors or timeouts
        console.warn("Proxy check failed:", error);
        proxyStatusMessage.textContent = "Failed to connect to proxy";
        proxyStatusMessage.innerHTML += " <span>&#x274C;</span> ";
        showProxyHelpLink();
        proxyDetailsContent.textContent = `Proxy at ${proxyAddress}`;
    });
}


function showProxyHelpLink() {
    proxyHelpLink.classList.remove('hidden');
    proxyHelpLink.href = chrome.runtime.getURL('proxy-help.html');

    proxyHelpLink.addEventListener('click', function (event) {
        event.preventDefault();
        chrome.tabs.create({url: this.href});
    });
}

const newPathUsageChild = (pathUsage: PerDomainPathUsage, index: number) => {
    // This is at the moment just for presentation purposes and needs to be
    // rewritten in the end...
    console.log("path usage: ", pathUsage)
    const isds: Set<number> = new Set(pathUsage.Path.map((v: string) => {
        const isd: string = v.split("-")[0];
        return Number.parseInt(isd);
    }));
    const ases = new Set(pathUsage.Path.map(v => v.split("-")[1]));
    const flagMap: Record<string, string> = {
        "EU": "images/european-union.png",
        "CH": "images/switzerland.png",
        "AWS": "images/amazon.png",
        "US": "images/united-states.png",
        "JP": "images/japan.png",
        "TW": "images/taiwan.png",
        "CN": "images/china.png",
        "KR": "images/south-korea.png",
        "KREONET": "images/south-korea.png",
        "AS": "images/asia.png",
        "NA": "images/north-america.png",
        "SSFN": "images/switzerland.png",
        "SCIERA": "images/scion-0.png",
        "HVR": "images/hin.png",
        "RESERVED": "images/unknown.png",
        "UNKNOWN": "images/unknown.png",
    }

    return (`
<div class="ac-sub">
    <input class="ac-input" id="ac-${index}" name="ac-${index}" type="checkbox" />
    <label class="ac-label" for="ac-${index}">${pathUsage.Domain}</label>
    <article class="ac-sub-text">
        <p><b>Strategy:</b>${pathUsage.Strategy}</p>
        <p><b>ISDs:</b></p>

        <div class="flag-container">
            ${[...isds].map((isd: number) =>
            `<div class="flag">
                <img src=${flagMap[returnCountryCode(isd)]}>
                <div class="description">
                    <p>(${returnCountryCode(isd)})</p>
                </div>
            </div>
            `).join("")}
        </div>
       
        <div class="ac-sub">
            <input class="ac-input" id="ac-${index}-path" name="ac-${index}-path" type="checkbox" />
            <label class="ac-label" for="ac-${index}-path"><b>Path:</b></label>
            <article class="ac-sub-text">
                ${pathUsage.Path.map(ia =>
                    `<div><p>${ia} (${asNameMap[ia.split("-")[1]]})</p></div>`
                ).join("")}
            </article >
        </div >
    </article >
</div > `)
}

function humanFileSize(bytes: number, si = false, dp = 1) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


    return bytes.toFixed(dp) + ' ' + units[u];
}

function returnCountryCode(isd: number) {
    const isdMap: Record<number, string> = {
        // Assignments used by SCIONLab
        19: "EU",
        17: "CH",
        16: "AWS",
        18: "US",
        21: "JP",
        22: "TW",
        25: "CN",
        20: "KR",
        26: "KREONET",
        // Assignments used by the production network
        64: "CH",
        65: "EU",
        66: "AS",
        67: "NA",
        68: "RESERVED",
        69: "RESERVED",
        70: "SSFN",
        71: "SCIERA",
        72: "HVR",
    }
    let code: string | undefined = isdMap[isd];
    if (code === undefined) {
        return "UNKNOWN";
    }
    return code;
}

// Start/Stop global forwarding
function toggleExtensionRunning() {
    toggleRunning.checked = !toggleRunning.checked;
    const newPerSiteStrictMode = {
        ...perSiteStrictMode,
        [popupMainDomain]: toggleRunning.checked,
    };

    if (toggleRunning.checked) {
        mainDomain.innerHTML = "SCION preference for " + popupMainDomain;
        lineRunning.style.backgroundColor = "#48bb78";
        scionmode.innerHTML = "Strict";
    } else {
        mainDomain.innerHTML = "SCION preference for " + popupMainDomain;
        lineRunning.style.backgroundColor = "#cccccc";
        scionmode.innerHTML = "When available";
    }

    saveSyncValue(PER_SITE_STRICT_MODE, newPerSiteStrictMode).then(() => {
        perSiteStrictMode = newPerSiteStrictMode;
    });

}

async function loadRequestInfo() {
    const tabs: Tab[] = await chrome.tabs.query({active: true, currentWindow: true});
    const activeTab: Tab = tabs[0];
    if (activeTab.url === undefined) {
        console.error("[Popup]: activeTab.url was undefined");
        return;
    }

    const hostname = safeHostname(activeTab.url);
    if (hostname === null) {
        console.error("[Popup]: error extracting hostname from url", activeTab.url);
        return;
    }
    popupMainDomain = hostname;

    const activeTabId = activeTab.id;
    if (activeTabId === undefined) {
        console.error("[Popup]: activeTabId was undefined for page with hostname: ", hostname);
        return;
    }

    const resources = await getTabResources(activeTabId) ?? [];
    const mainDomainSCIONEnabled = resources.find(resource => resource[0] === hostname && resource[1]);

    if (perSiteStrictMode[hostname]) {
        mainDomain.innerHTML = "SCION preference for " + hostname;
        toggleRunning.checked = true; // true
        toggleRunning.classList.remove("halfchecked");
        lineRunning.style.backgroundColor = "#48bb78";
        scionmode.innerHTML = "Strict";
    } else if (mainDomainSCIONEnabled) {
        mainDomain.innerHTML = "SCION preference for " + hostname;
        toggleRunning.checked = false; // true
        toggleRunning.classList.add("halfchecked");
        lineRunning.style.backgroundColor = "#cccccc";
        scionmode.innerHTML = "When available";
    } else {
        scionModePreference.style.display = "none";
    }// TODO: Else case would be no SCION... toggleRunning.checked = false;

    let mixedContent = false
    for (const resource of resources) {
        const domain = resource[0];
        const scionEnabled = resource[1];

        let p = document.createElement("p");
        p.style.fontSize = "14px"
        if (scionEnabled) {
            p.innerHTML = "<span>&#x2705;</span> " + domain;
        } else {
            mixedContent = true;
            p.innerHTML = "<span>&#x274C;</span> " + domain;
        }

        domainList.appendChild(p);
    }

    if (mainDomainSCIONEnabled) {
        if (mixedContent) {
            scionsupport.innerHTML = "Not all resources loaded via SCION";
        } else {
            scionsupport.innerHTML = "All resources loaded via SCION";
        }
    } else {
        scionsupport.innerHTML = "No resourced loaded via SCION";
    }

    // Update path usage for the current domain
    updatePathUsage();
}

