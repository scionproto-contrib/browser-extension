import {IsolationDomain} from "./isolation_domain.js";


/**
 * Returns the name of the provided {@link isolationDomain}.
 */
export function getISDName(isolationDomain: IsolationDomain) {
    return isdNameMap[isolationDomain];
}

/**
 * Returns the path to the image representing the provided {@link isolationDomain}.
 */
export function getISDCountryFlagPath(isolationDomain: IsolationDomain) {
    const basePath = "/images/";
    return basePath + isdImageNameMap[isolationDomain];
}

/**
 * Converts an ISD number into its corresponding {@link IsolationDomain} enum entry representation.
 * If {@link IsolationDomain} does not contain a corresponding entry, {@link IsolationDomain.UNKNOWN} is returned instead.
 */
export function toIsolationDomain(isdNumber: number) {
    let isd: IsolationDomain | undefined = isdMap[isdNumber];
    if (isd === undefined) {
        return IsolationDomain.UNKNOWN;
    }
    return isd;
}

/**
 * Maps the ISD number to the corresponding {@link IsolationDomain} enum value.
 *
 * The entries in this map regarding the production network correspond to the table on the Anapaya docs page: https://learn.anapaya.net/docs/resources/assignments/isds/.
 */
const isdMap: Record<number, IsolationDomain> = {
    // Assignments used by SCIONLab
    19: IsolationDomain.Europe,
    17: IsolationDomain.CH,
    16: IsolationDomain.AmazonWebServices,
    18: IsolationDomain.US,
    21: IsolationDomain.JP,
    22: IsolationDomain.TW,
    25: IsolationDomain.CN,
    20: IsolationDomain.KR,
    26: IsolationDomain.KREONET,
    // Assignments used by the production network
    64: IsolationDomain.CH,
    65: IsolationDomain.Europe,
    66: IsolationDomain.Asia,
    67: IsolationDomain.NorthAmerica,
    68: IsolationDomain.DEPRECATED,
    69: IsolationDomain.RESERVED,
    70: IsolationDomain.SSFN,
    71: IsolationDomain.SCIERA,
    72: IsolationDomain.SSHN,
    73: IsolationDomain.RESERVED,
    74: IsolationDomain.SEPN,
    75: IsolationDomain.Benelux,
    76: IsolationDomain.SSUN,
    77: IsolationDomain.RESERVED,
    78: IsolationDomain.RESERVED,
    79: IsolationDomain.RESERVED,
}
const isdImageNameMap: Record<IsolationDomain, string> = {
    [IsolationDomain.Europe]: "european-union.png",
    [IsolationDomain.CH]: "switzerland.png",
    [IsolationDomain.AmazonWebServices]: "amazon.png",
    [IsolationDomain.US]: "united-states.png",
    [IsolationDomain.JP]: "japan.png",
    [IsolationDomain.TW]: "taiwan.png",
    [IsolationDomain.CN]: "china.png",
    [IsolationDomain.KR]: "south-korea.png",
    [IsolationDomain.KREONET]: "south-korea.png",
    [IsolationDomain.Asia]: "asia.png",
    [IsolationDomain.NorthAmerica]: "north-america.png",
    [IsolationDomain.SSFN]: "switzerland.png",
    [IsolationDomain.SCIERA]: "scion-0.png",
    [IsolationDomain.SSHN]: "hin.png",
    [IsolationDomain.SEPN]: "unknown.png",
    [IsolationDomain.Benelux]: "unknown.png",
    [IsolationDomain.SSUN]: "unknown.png",
    [IsolationDomain.DEPRECATED]: "unknown.png",
    [IsolationDomain.RESERVED]: "unknown.png",
    [IsolationDomain.UNKNOWN]: "unknown.png",
}
const isdNameMap: Record<IsolationDomain, string> = {
    [IsolationDomain.Europe]: "European Union",
    [IsolationDomain.CH]: "Switzerland",
    [IsolationDomain.AmazonWebServices]: "Amazon",
    [IsolationDomain.US]: "United States",
    [IsolationDomain.JP]: "Japan",
    [IsolationDomain.TW]: "Taiwan",
    [IsolationDomain.CN]: "China",
    [IsolationDomain.KR]: "South Korea",
    [IsolationDomain.KREONET]: "South Korea",
    [IsolationDomain.Asia]: "Asia",
    [IsolationDomain.NorthAmerica]: "North America",
    [IsolationDomain.SSFN]: "Switzerland",
    [IsolationDomain.SCIERA]: "SCIERA",
    [IsolationDomain.SSHN]: "Health Info Net (HIN)",
    [IsolationDomain.SEPN]: "Secure EFTPOS Network",
    [IsolationDomain.Benelux]: "Benelux: Belgium, Netherlands, Luxembourg.",
    [IsolationDomain.SSUN]: "Secure Swiss Utility Network",
    [IsolationDomain.DEPRECATED]: "Deprecated",
    [IsolationDomain.RESERVED]: "Reserved",
    [IsolationDomain.UNKNOWN]: "Unknown",
}