import { ADSENSE_SCRIPT_URL } from "./adsense";

// Exact origin of the consent message, distinct from its AFC bootstrap.
export const GOOGLE_CMP_ORIGIN = "https://fundingchoicesmessages.google.com";
// AdSense for Content deploys European messages through its AdSense tag.
// The ad-blocking recovery /i/ tag is not a standalone AFC CMP bootstrap.
// The caller MUST pause requests before insertion and must not request a slot
// while the independent advertising release gate is closed.
export const GOOGLE_CMP_SCRIPT_URL = ADSENSE_SCRIPT_URL;
