const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const routes = ["/", "/discographie", "/commander", "/boutique", "/a-propos", "/contact"];

let failed = false;

for (const route of routes) {
  try {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    const body = await response.text();
    const valid = response.status === 200 && body.includes("LNX Beats") && body.includes("</html>");
    console.log(`${valid ? "OK" : "KO"} ${route} — HTTP ${response.status}`);
    if (!valid) failed = true;
  } catch (error) {
    failed = true;
    console.error(`KO ${route} — ${error instanceof Error ? error.message : "erreur inconnue"}`);
  }
}

try {
  const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
  const payload = await response.json();
  const valid = response.status === 200 && payload.ok === true && payload.service === "lnx-studio";
  console.log(`${valid ? "OK" : "KO"} /api/health — HTTP ${response.status}`);
  if (!valid) failed = true;
} catch (error) {
  failed = true;
  console.error(`KO /api/health — ${error instanceof Error ? error.message : "erreur inconnue"}`);
}

if (failed) process.exitCode = 1;
