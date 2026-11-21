// Captures de toutes les vues, après connexion, aux trois formats, de jour et de nuit.
// Usage : node e2e/views.cjs <dossier> [password]   (hubs de démonstration sur 8100 jour et 8101 nuit)
const { chromium } = require("playwright");
const out = process.argv[2] || "shots";
const password = process.argv[3] || "test-family-password";
const sizes = { phone: [390, 844], tablet: [1280, 800], desktop: [1600, 1000] };
const runs = [
  { name: "day", base: "http://localhost:8100", at: "2026-11-14T03:00:00Z" },
  { name: "night", base: "http://localhost:8101", at: "2026-11-14T11:30:00Z" },
];
const views = (process.env.VIEWS || "home,weather,beach,sky,overhead,fire,news,track,settings").split(",");

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const run of runs) for (const [size, [w, h]] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${run.base}/login`);
    await page.fill("#pw", password);
    await page.click("button[type=submit]");
    await page.waitForURL(`${run.base}/`);
    for (const v of views) {
      // Toutes les vues à tous les formats : le contrôle des ascenseurs internes doit tout couvrir.
      await page.goto(`${run.base}/?at=${run.at}#${v}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${size}-${run.name}-${v}.png`, fullPage: size === "tablet" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      // Le corps coupe ce qui dépasse (overflow-x: clip) : on cherche donc aussi les blocs qui sortent de l'écran.
      const cut = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => !el.closest(".leaflet-container") && !(el instanceof SVGElement && el.ownerSVGElement)
        && el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== "fixed").map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`));
      if (overflow || cut.length) { failures++; console.log("HORIZONTAL OVERFLOW", size, run.name, v, cut.slice(0, 4)); }
      // Pas d'ascenseur à l'intérieur d'un bloc : seule la page défile (les cartes Leaflet gèrent leur propre déplacement).
      const inner = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
        if (el.closest(".leaflet-container")) return false;
        const cs = getComputedStyle(el);
        const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
        const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
        return x || y;
      }).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`));
      if (inner.length) { failures++; console.log("INNER SCROLL", size, run.name, v, inner.slice(0, 4)); }
    }
    if (errors.length) { failures++; console.log("ERRORS", size, run.name, errors.slice(0, 3).map((e) => e.slice(0, 160))); }
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `${failures} problem(s)` : "all views ok");
  process.exit(failures ? 1 : 0);
})();
