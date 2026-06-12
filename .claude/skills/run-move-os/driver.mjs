// Driver de navegador para MoveOS (contenedores sin Chrome del sistema).
// Usa el Chromium empaquetado en npm (@sparticuz/chromium) + playwright-core
// porque el CDN de Playwright está bloqueado por la política de red.
//
// Bootstrap (una vez):  cd .claude/skills/run-move-os && npm install
//
// Comandos:
//   node driver.mjs shot <url> <out.png> [email] [password]
//       Abre la URL; si hay credenciales, llena el login y envía. Captura.
//   node driver.mjs triage <out.png>
//       Flujo real del dashboard: login admin → cockpit de excepciones →
//       "Abrir triage" → "Revisar" un pedido → editor de pin (Leaflet).
//   node driver.mjs flywheel <out.png>
//       Login del operador en el panel admin → página /flywheel.
//
// Env: WEB_URL (5173), ADMIN_URL (5175), MOVEOS_EMAIL, MOVEOS_PASSWORD.
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:5175";
const [cmd, ...rest] = process.argv.slice(2);

const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function login(url, email, password) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  // OJO: el botón de login de la app de conductor no declara type="submit".
  await page.locator('button[type="submit"], form button').first().click();
  await page.waitForTimeout(2500);
}

async function save(out) {
  await page.screenshot({ path: out, fullPage: true });
  console.log("saved", out, "| title:", await page.title(), "| url:", page.url());
}

try {
  if (cmd === "shot") {
    const [url, out, email, password] = rest;
    if (email && password) await login(url, email, password);
    else await page.goto(url, { waitUntil: "networkidle" });
    await save(out);
  } else if (cmd === "triage") {
    const [out] = rest;
    await login(
      WEB_URL,
      process.env.MOVEOS_EMAIL ?? "admin@demo.moveos.co",
      process.env.MOVEOS_PASSWORD ?? "moveos123",
    );
    await page.waitForURL("**/excepciones", { timeout: 10000 });
    await page.click("text=Abrir triage");
    await page.waitForURL("**/direcciones", { timeout: 10000 });
    await page.waitForSelector("text=Por revisar", { timeout: 10000 });
    await page.click('button:has-text("Revisar")');
    await page.waitForSelector(".leaflet-container", { timeout: 10000 });
    await page.waitForTimeout(2000); // teselas OSM (grises si la red las bloquea)
    await save(out);
  } else if (cmd === "flywheel") {
    const [out] = rest;
    await login(ADMIN_URL, "ops@moveos.co", "moveos123");
    await page.goto(`${ADMIN_URL}/flywheel`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await save(out);
  } else {
    console.error("Comando desconocido. Usa: shot | triage | flywheel");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
