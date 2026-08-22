# The "Official" Taco Bell Tier List

One superfan. Every menu item. Version controlled.

I try every Taco Bell menu item when it comes out and rate it here. The repo is
the database: menu facts are synced from tacobell.com's own API using their real
product codes, my opinions live in small hand-written JSON files, and git
history is the changelog of my palate.

> Not affiliated with, endorsed by, or in any way official to Taco Bell or
> Yum! Brands. Just a fan with a git repo.

## How it works

Three kinds of data, joined by Taco Bell's product code, never overlapping:

- **`data/catalog.json`**: machine-owned. A vendored snapshot of the live menu
  (names, calories, prices, categories, images). Only `scripts/sync.ts` writes
  it. Items that leave the menu are kept and marked `discontinued`, so the
  graveyard tier never loses its history.
- **`data/ranking.json`**: the ordinal truth. One array per tier; position in
  the array IS the rating (earlier = better). There are no numeric scores,
  because a tier list is relative judgment: an item is placed by dragging it
  above and below its peers, not by inventing a number. Moving an item is a
  one-line diff, so `git log -p data/ranking.json` is a changelog of my palate.
- **`data/reviews/*.json`**: the qualitative record. One file per item, and
  it only ever holds the *current* verdict: date, notes, tags. Re-reviewing
  overwrites; the old opinion is preserved by git, which is the entire
  history mechanism of this project. Validated against
  `data/schema/review.schema.json`; the build cross-checks that ranking and
  reviews agree exactly (every ranked item has a review, every review is
  ranked once).

`site/` is a zero-dependency static page (GitHub Pages friendly) that renders
one built file, `site/data.json`. Product images are vendored into
`site/images/` at sync time so nothing hotlinks Taco Bell's CDN and retired
items keep their portraits forever.

## Workflow

The main tool is the local review console:

```sh
bun run review        # serve http://localhost:4173 with admin mode unlocked
```

It is the public site plus an admin layer that only exists locally (the page
probes a localhost-only API; on GitHub Pages the probe fails and visitors get
the read-only board). Unrated items sit in a backlog shelf at the top; drag one
into a tier at the exact position it deserves, write the verdict in its modal,
save, and the bell rings. Everything it does is a plain-JSON file write:
review a batch, then `git diff`, commit, push. That's the whole CMS.

The same edits can be made by hand:

```sh
bun run sync          # pull the live menu + new images (TB_STORE=xxxxxx to override store)
bun run new 22850 B   # scaffold a review, place it last in tier B
$EDITOR data/reviews/chalupa-supreme.json   # notes
$EDITOR data/ranking.json                   # move it to its rightful position
bun run dev           # build + serve the read-only site
bun run validate      # CI check: schemas + ranking/review/catalog cross-checks
```

## The API, informally

tacobell.com is powered by an unauthenticated JSON endpoint:

```
GET https://www.tacobell.com/tacobellwebservices/v4/tacobell/products/menu/{storeNumber}
```

It returns the full menu for a store with stable numeric product codes, which
this project uses as canonical IDs. It is undocumented and could change at any
time; `sync.ts` fails loudly rather than writing garbage. Fun fact: the Chalupa
Supreme's official description has shipped with "diced tomaotes" for years.
