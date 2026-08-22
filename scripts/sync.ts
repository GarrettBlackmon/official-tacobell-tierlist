// Sync the vendored catalog + product images from the live tacobell.com menu API.
// Machine-owned: this script is the only thing that writes data/catalog.json.
//
//   bun run sync            # uses the store below
//   TB_STORE=030297 bun run sync

// Home store: 1553 Montgomery Hwy, Hoover AL
const STORE = process.env.TB_STORE ?? "039116";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOG_PATH = `${ROOT}data/catalog.json`;
const IMAGES_DIR = `${ROOT}site/images`;

interface CatalogItem {
  code: string;
  slug: string;
  name: string;
  calories: string;
  price: number | null;
  priceFormatted: string | null;
  itemType: string;
  hasMeatless: boolean;
  primaryCategory: string;
  categories: string[];
  url: string | null;
  firstSeen: string;
  lastSeen: string;
  discontinued: boolean;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

console.log(`Fetching menu for store ${STORE} ...`);
const res = await fetch(
  `https://www.tacobell.com/tacobellwebservices/v4/tacobell/products/menu/${STORE}`,
  { headers: { "user-agent": UA } },
);
if (!res.ok) throw new Error(`Menu request failed: HTTP ${res.status}`);
const menu = await res.json();
if (!Array.isArray(menu?.menuProductCategories)) {
  throw new Error("Unexpected response shape: menuProductCategories missing");
}

// Fold every category's products into one map keyed by product code.
const live = new Map<string, CatalogItem>();
const imageUrls = new Map<string, string>();

for (const cat of menu.menuProductCategories) {
  for (const p of cat.products ?? []) {
    if (!p?.code || !p?.name) continue;
    const existing = live.get(p.code);
    if (existing) {
      if (!existing.categories.includes(cat.code)) existing.categories.push(cat.code);
      continue;
    }
    const urlSlug = typeof p.url === "string" ? p.url.split("/").filter(Boolean).pop() : null;
    live.set(p.code, {
      code: p.code,
      slug: urlSlug || slugify(p.name),
      name: p.name,
      calories: p.calories ?? "",
      price: p.price?.value ?? null,
      priceFormatted: p.price?.formattedValue ?? null,
      itemType: p.itemType ?? "Product",
      hasMeatless: !!p.hasMeatless,
      primaryCategory: p.primaryCategory ?? cat.code,
      categories: [cat.code],
      url: typeof p.url === "string" ? p.url : null,
      firstSeen: today,
      lastSeen: today,
      discontinued: false,
    });
    const img = (p.images ?? []).find((i: any) => i.format === "269x269");
    if (img?.url) imageUrls.set(p.code, img.url);
  }
}
console.log(`Live menu: ${live.size} unique items`);

// Merge with the previous catalog so discontinued items are kept, not lost.
let previous: Record<string, CatalogItem> = {};
try {
  previous = JSON.parse(await Bun.file(CATALOG_PATH).text()).items ?? {};
} catch {
  console.log("No existing catalog, starting fresh.");
}

const items: Record<string, CatalogItem> = {};
let added = 0, retired = 0;
for (const [code, old] of Object.entries(previous)) {
  if (!live.has(code)) {
    if (!old.discontinued) {
      retired++;
      console.log(`  retired: ${old.name} (${code})`);
    }
    items[code] = { ...old, discontinued: true };
  }
}
for (const [code, item] of live) {
  const old = previous[code];
  if (!old) {
    added++;
    console.log(`  new:     ${item.name} (${code})`);
  }
  items[code] = { ...item, firstSeen: old?.firstSeen ?? today };
}

const sorted = Object.fromEntries(
  Object.entries(items).sort(([a], [b]) => a.localeCompare(b)),
);
await Bun.write(
  CATALOG_PATH,
  JSON.stringify({ syncedAt: today, store: STORE, items: sorted }, null, 2) + "\n",
);
console.log(`Catalog written: ${Object.keys(sorted).length} items (+${added} new, ${retired} newly retired)`);

// Vendor 269x269 images we don't have yet (write-once; retired items keep theirs).
const missing = [...imageUrls.entries()].filter(
  ([code]) => !Bun.file(`${IMAGES_DIR}/${code}.jpg`).size,
);
console.log(`Downloading ${missing.length} images ...`);
let failed = 0;
for (let i = 0; i < missing.length; i += 8) {
  await Promise.all(
    missing.slice(i, i + 8).map(async ([code, url]) => {
      try {
        const r = await fetch(url, { headers: { "user-agent": UA } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await Bun.write(`${IMAGES_DIR}/${code}.jpg`, await r.arrayBuffer());
      } catch (e) {
        failed++;
        console.error(`  image failed for ${code}: ${e}`);
      }
    }),
  );
}
console.log(`Images done (${failed} failures). Sync complete.`);
