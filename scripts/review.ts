// Local review console:  bun run review
// Serves the same site/ as production, plus the admin API that unlocks
// editing in the browser. Localhost only; writes the same JSON files you
// would edit by hand, never touches git.

import { readdirSync, rmSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4173);

const types: Record<string, string> = {
  html: "text/html", css: "text/css", js: "text/javascript",
  json: "application/json", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml",
  mp3: "audio/mpeg",
};

async function rebuild(): Promise<string | null> {
  const proc = Bun.spawn(["bun", `${ROOT}scripts/build.ts`], { stderr: "pipe", stdout: "pipe" });
  const code = await proc.exited;
  if (code !== 0) return await new Response(proc.stderr).text();
  return null;
}

async function readState() {
  const catalog = JSON.parse(await Bun.file(`${ROOT}data/catalog.json`).text());
  const ranking = JSON.parse(await Bun.file(`${ROOT}data/ranking.json`).text());
  const reviews: Record<string, any> = {};
  for (const f of readdirSync(`${ROOT}data/reviews`).filter((f) => f.endsWith(".json"))) {
    const r = JSON.parse(await Bun.file(`${ROOT}data/reviews/${f}`).text());
    reviews[r.slug] = r;
  }
  return { catalog, ranking, reviews };
}

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SLUG_RE = /^[a-z0-9-]+$/;

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // ── admin API ──
    if (url.pathname === "/api/state") return json(await readState());

    if (url.pathname === "/api/ranking" && req.method === "POST") {
      const { ranking } = await req.json();
      const state = await readState();
      const seen = new Set<string>();
      for (const tier of Object.keys(state.ranking)) {
        if (!Array.isArray(ranking?.[tier])) return json({ error: `missing tier ${tier}` }, 400);
        for (const slug of ranking[tier]) {
          if (seen.has(slug)) return json({ error: `${slug} ranked twice` }, 400);
          seen.add(slug);
          if (!state.reviews[slug]) return json({ error: `${slug} has no review` }, 400);
        }
      }
      if (seen.size !== Object.keys(state.reviews).length)
        return json({ error: "ranking and reviews out of sync" }, 400);
      await Bun.write(`${ROOT}data/ranking.json`, JSON.stringify(ranking, null, 2) + "\n");
      const err = await rebuild();
      return err ? json({ error: err }, 400) : json({ ok: true });
    }

    if (url.pathname === "/api/review" && req.method === "POST") {
      const review = await req.json();
      if (!SLUG_RE.test(review?.slug ?? "")) return json({ error: "bad slug" }, 400);
      const state = await readState();
      if (!state.catalog.items[review?.code]) return json({ error: `code ${review?.code} not in catalog` }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(review?.date ?? ""))
        return json({ error: "bad date" }, 400);
      const clean = {
        code: review.code,
        slug: review.slug,
        tags: (review.tags ?? []).filter((t: any) => typeof t === "string"),
        date: review.date,
        ...(review.notes ? { notes: String(review.notes) } : {}),
      };
      await Bun.write(`${ROOT}data/reviews/${clean.slug}.json`, JSON.stringify(clean, null, 2) + "\n");
      // a brand-new review isn't ranked yet; caller POSTs /api/ranking next,
      // so skip the rebuild (it would fail the bijection check mid-flight)
      const ranked = Object.values(state.ranking).some((arr: any) => arr.includes(clean.slug));
      if (!ranked) return json({ ok: true, pending: true });
      const err = await rebuild();
      return err ? json({ error: err }, 400) : json({ ok: true });
    }

    if (url.pathname === "/api/review" && req.method === "DELETE") {
      const slug = url.searchParams.get("slug") ?? "";
      if (!SLUG_RE.test(slug)) return json({ error: "bad slug" }, 400);
      const state = await readState();
      if (!state.reviews[slug]) return json({ error: "no such review" }, 404);
      rmSync(`${ROOT}data/reviews/${slug}.json`);
      for (const tier of Object.keys(state.ranking))
        state.ranking[tier] = state.ranking[tier].filter((s: string) => s !== slug);
      await Bun.write(`${ROOT}data/ranking.json`, JSON.stringify(state.ranking, null, 2) + "\n");
      const err = await rebuild();
      return err ? json({ error: err }, 400) : json({ ok: true });
    }

    // ── static site ──
    let path = url.pathname;
    if (path === "/") path = "/index.html";
    const file = Bun.file(`${ROOT}site/${path.slice(1)}`);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const ext = path.split(".").pop() ?? "";
    return new Response(file, { headers: { "content-type": types[ext] ?? "application/octet-stream" } });
  },
});

const err = await rebuild();
if (err) console.error(err);
console.log(`Review console at http://localhost:${PORT} (admin mode unlocked)`);
