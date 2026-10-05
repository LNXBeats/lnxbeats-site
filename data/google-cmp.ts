import { ADSENSE_PUBLISHER_ID } from "./adsense";

// Exact messaging tag supplied by AdSense > Privacy & messaging > Tagging.
// This is NOT the adsbygoogle advertising loader.
export const GOOGLE_CMP_ORIGIN = "https://fundingchoicesmessages.google.com";
export const GOOGLE_CMP_SCRIPT_URL = `${GOOGLE_CMP_ORIGIN}/i/${ADSENSE_PUBLISHER_ID}?ers=1`;
