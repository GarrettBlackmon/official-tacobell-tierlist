// Validate reviews + ranking and roll catalog + tiers + reviews into
// site/data.json. The site only ever reads that one file.
//
// Ordinal model: data/ranking.json is the single source of truth for which
// tier an item is in AND its position within it (earlier = better). Review
// files hold only the qualitative record (tasting log, tags).
//
//   bun run build           # validate + write site/data.json
//   bun run validate        # validate only (build.ts --check)

import { readdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const checkOnly = process.argv.includes("--check");

const catalog = JSON.parse(await Bun.file(`${ROOT}data/catalog.json`).text());
const { tiers } = JSON.parse(await Bun.file(`${ROOT}data/tiers.json`).text());
const ranking = JSON.parse(await Bun.file(`${ROOT}data/ranking.json`).text());
const tierIds = tiers.map((t: any) => t.id);

const errors: string[] = [];

// ── reviews: qualitative record ──
const reviews = new Map<string, any>(); // slug → review
const seenCodes = new Map<string, string>();
const files = readdirSync(`${ROOT}data/reviews`).filter((f) => f.endsWith(".json")).sort();
for (const file of files) {
  const review = JSON.parse(await Bun.file(`${ROOT}data/reviews/${file}`).text());
  const where = `reviews/${file}`;

  if (!review.code) errors.push(`${where}: missing "code"`);
  else if (!catalog.items[review.code]) errors.push(`${where}: code ${review.code} not in catalog.json (run sync?)`);
  if (seenCodes.has(review.code)) errors.push(`${where}: duplicate code ${review.code} (also in ${seenCodes.get(review.code)})`);
  seenCodes.set(review.code, file);
  if (review.slug !== file.replace(/\.json$/, "")) errors.push(`${where}: slug "${review.slug}" does not match filename`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date ?? "")) errors.push(`${where}: bad date "${review.date}"`);
  reviews.set(review.slug, review);
}

// ── ranking: ordinal truth; must be a bijection with the review set ──
const ranked = new Set<string>();
for (const tierId of Object.keys(ranking)) {
  if (!tierIds.includes(tierId)) errors.push(`ranking.json: unknown tier "${tierId}"`);
  for (const slug of ranking[tierId]) {
    if (ranked.has(slug)) errors.push(`ranking.json: "${slug}" appears more than once`);
    ranked.add(slug);
    if (!reviews.has(slug)) errors.push(`ranking.json: "${slug}" (tier ${tierId}) has no review file`);
  }
}
for (const tierId of tierIds) {
  if (!(tierId in ranking)) errors.push(`ranking.json: missing tier "${tierId}" (use an empty array)`);
}
for (const slug of reviews.keys()) {
  if (!ranked.has(slug)) errors.push(`reviews/${slug}.json: not placed in ranking.json`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Validated ${files.length} review(s) + ranking.`);
if (checkOnly) process.exit(0);

// rated items in tier order, then rank order — position is the rating
const rated: any[] = [];
for (const tier of tiers) {
  (ranking[tier.id] ?? []).forEach((slug: string, i: number) => {
    const review = reviews.get(slug);
    const item = catalog.items[review.code];
    rated.push({
      code: review.code,
      slug,
      tier: tier.id,
      rank: i + 1,
      date: review.date,
      notes: review.notes ?? "",
      tags: review.tags ?? [],
      name: item.name,
      calories: item.calories,
      priceFormatted: item.priceFormatted,
      primaryCategory: item.primaryCategory,
      discontinued: item.discontinued,
    });
  });
}

const all = Object.values(catalog.items) as any[];
const out = {
  generatedAt: new Date().toLocaleDateString("en-CA"),
  syncedAt: catalog.syncedAt,
  store: catalog.store,
  tiers,
  rated,
  stats: {
    menuItems: all.filter((i) => !i.discontinued).length,
    rated: rated.length,
    discontinued: all.filter((i) => i.discontinued).length,
  },
};
await Bun.write(`${ROOT}site/data.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`site/data.json written: ${rated.length} rated of ${out.stats.menuItems} menu items.`);
