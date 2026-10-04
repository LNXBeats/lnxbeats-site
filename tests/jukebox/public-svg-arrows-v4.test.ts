import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("V4 scoped public navigation uses decorative SVG arrows without changing visible link labels", async () => {
  for (const path of [
    "components/home-jukebox.tsx", "components/album-card.tsx", "components/creations/creation-collaborators.tsx",
    "components/support-form.tsx", "components/music-order-form.tsx", "app/album/[slug]/page.tsx",
    "app/creations/[slug]/page.tsx", "app/boutique/page.tsx", "app/boutique/[slug]/page.tsx", "app/boutique/panier/page.tsx",
  ]) {
    const text = await source(path);
    assert.doesNotMatch(text, /[→↗←]/, path);
    assert.match(text, /<UiIcon name="arrow-(?:right|left|up-right)" \/>/, path);
  }
  const form = await source("components/music-order-form.tsx");
  assert.match(form, /onClick=\{\(\) => moveToStep\(step - 1\)\} disabled=\{busy\}><UiIcon name="arrow-left" \/> Étape précédente/);
  assert.match(form, /onClick=\{\(\) => void nextStep\(\)\} disabled=\{busy\}>Étape suivante <UiIcon name="arrow-right" \/>/);
  const support = await source("components/support-form.tsx");
  for (const [provider, label] of [["STRIPE", "Stripe"], ["PAYPAL", "PayPal"]]) {
    assert.ok(support.includes(`onClick={() => void checkout("${provider}")}>Soutenir avec ${label}`));
  }
  assert.match(await source("app/contact/page.tsx"), /<section id="plateformes" className=\{styles\.platformSection\}/);
});

test("shared arrow glyphs actually render as inert monochrome SVG, never accessible-name text", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { UiIcon } from "./components/ui-icon.tsx";
    console.log(JSON.stringify(["arrow-left", "arrow-right", "arrow-up-right"].map(name => renderToStaticMarkup(React.createElement(UiIcon, { name })))));
  `], { cwd: new URL("../..", import.meta.url), env: { ...process.env, NODE_OPTIONS: "" } });
  const markup: string[] = JSON.parse(stdout);
  assert.equal(markup.length, 3);
  for (const svg of markup) {
    assert.match(svg, /^<svg/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, /<path d="[^"]+"/);
    assert.doesNotMatch(svg, /[→↗←]|<text|<title/);
  }
});
