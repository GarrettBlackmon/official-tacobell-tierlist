// Scaffold a review and place it in the ranking:
//   bun run new <product-code> [tier]     (defaults to end of C)
const code = process.argv[2];
const tier = process.argv[3] ?? "C";
if (!code) {
  console.error("Usage: bun run new <product-code> [tier]");
  process.exit(1);
}

const ROOT = new URL("..", import.meta.url).pathname;
const catalog = JSON.parse(await Bun.file(`${ROOT}data/catalog.json`).text());
const ranking = JSON.parse(await Bun.file(`${ROOT}data/ranking.json`).text());
if (!(tier in ranking)) {
  console.error(`Unknown tier "${tier}". Tiers: ${Object.keys(ranking).join(", ")}`);
  process.exit(1);
}
const item = catalog.items[code];
if (!item) {
  console.error(`Code ${code} not in catalog. Run "bun run sync" first, or check the code.`);
  const hits = Object.values(catalog.items).filter((i: any) =>
    i.name.toLowerCase().includes(code.toLowerCase()),
  ) as any[];
  if (hits.length) {
    console.error("Did you mean:");
    for (const h of hits) console.error(`  ${h.code}  ${h.name}`);
  }
  process.exit(1);
}

const path = `${ROOT}data/reviews/${item.slug}.json`;
if (await Bun.file(path).exists()) {
  console.error(`${path} already exists.`);
  process.exit(1);
}

const stub = {
  code: item.code,
  slug: item.slug,
  tags: [item.primaryCategory],
  date: new Date().toLocaleDateString("en-CA"),
  notes: "",
};
await Bun.write(path, JSON.stringify(stub, null, 2) + "\n");

ranking[tier].push(item.slug);
await Bun.write(`${ROOT}data/ranking.json`, JSON.stringify(ranking, null, 2) + "\n");
console.log(`Scaffolded ${path} for "${item.name}", placed last in ${tier}.`);
console.log(`Reorder it in data/ranking.json; fill in notes in the review file.`);
