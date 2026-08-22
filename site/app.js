const $ = (sel, el = document) => el.querySelector(sel);
const today = () => new Date().toLocaleDateString("en-CA");

// ── the bell ──
const bong = new Audio("audio/bell.mp3");
bong.preload = "auto";
function ringBell() {
  bong.currentTime = 0;
  bong.play().catch(() => {}); // autoplay policy: stays quiet until a gesture
  const bell = $(".bell-mark");
  bell.classList.remove("ringing");
  void bell.offsetWidth; // restart the swing animation
  bell.classList.add("ringing");
}

let DATA = null;   // built data.json (what the public site sees)
let ADMIN = null;  // { catalog, ranking, reviews } when the local API exists

async function loadAll() {
  DATA = await (await fetch("data.json", { cache: "no-store" })).json();
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    ADMIN = r.ok ? await r.json() : null;
  } catch {
    ADMIN = null;
  }
  document.body.classList.toggle("admin", !!ADMIN);
}

function esc(s) {
  const d = document.createElement("span");
  d.textContent = s ?? "";
  return d.innerHTML;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(`Save failed:\n${out.error ?? res.status}`);
    throw new Error(out.error ?? String(res.status));
  }
  return out;
}

// ── rendering ──

function makeCard(item, { grayed = false } = {}) {
  const card = document.createElement("button");
  card.className = "item-card" + (grayed ? " unrated" : "");
  card.dataset.slug = item.slug;
  card.title = item.name;
  card.innerHTML = `
    <img src="images/${item.code}.jpg" alt="" loading="lazy" width="96" height="96">
    <span class="item-name"></span>`;
  $(".item-name", card).textContent = item.name;
  card.addEventListener("click", () => openModal(item));
  if (ADMIN) {
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      DRAG = { slug: item.slug, code: item.code, fromBacklog: grayed };
      e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => card.classList.add("card-dragging"));
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("card-dragging");
      indicator.remove();
      DRAG = null;
    });
  }
  return card;
}

function render() {
  $("#stats").textContent =
    `${DATA.stats.rated} of ${DATA.stats.menuItems} current menu items rated` +
    (DATA.stats.discontinued ? ` · ${DATA.stats.discontinued} in the graveyard` : "");
  $("#synced").textContent =
    `Menu data synced from tacobell.com on ${DATA.syncedAt} (store #${DATA.store})`;

  const board = $("#board");
  board.innerHTML = "";
  if (ADMIN) renderBacklog(board); // judgment queue first, board below
  for (const tier of DATA.tiers) {
    const items = DATA.rated.filter((r) => r.tier === tier.id);
    const row = document.createElement("div");
    row.className = `tier-row tier-${tier.id}`;
    row.innerHTML = `
      <div class="tier-badge">
        <span class="tier-letter">${tier.id}</span>
        <span class="tier-name">${esc(tier.name)}</span>
      </div>
      <div class="tier-items" data-tier="${tier.id}"></div>`;
    const holder = $(".tier-items", row);
    if (items.length === 0 && !ADMIN) {
      holder.innerHTML = `<span class="tier-empty">nothing here yet&hellip;</span>`;
    }
    for (const item of items) holder.appendChild(makeCard(item));
    if (ADMIN) wireDropZone(holder);
    board.appendChild(row);
  }
}

function renderBacklog(board) {
  const reviewed = new Set(Object.keys(ADMIN.reviews));
  const backlog = Object.values(ADMIN.catalog.items)
    .filter((i) => !i.discontinued && !reviewed.has(i.slug))
    .sort((a, b) => a.primaryCategory.localeCompare(b.primaryCategory) || a.name.localeCompare(b.name));

  const row = document.createElement("div");
  row.className = "tier-row backlog";
  row.innerHTML = `
    <div class="tier-badge">
      <span class="tier-letter">?</span>
      <span class="tier-name">Backlog · ${backlog.length}</span>
    </div>
    <div class="tier-items" data-tier=""></div>`;
  const holder = $(".tier-items", row);
  if (backlog.length === 0) {
    holder.innerHTML = `<span class="tier-empty">backlog cleared. Live Más achieved.</span>`;
  }
  for (const item of backlog) holder.appendChild(makeCard(item, { grayed: true }));
  wireDropZone(holder); // dropping a ranked card here un-rates it
  board.appendChild(row);
}

// ── drag to rank ──

let DRAG = null;
const indicator = document.createElement("span");
indicator.className = "drop-indicator";

function cardsIn(holder) {
  return [...holder.querySelectorAll(".item-card:not(.card-dragging)")];
}

function placeIndicator(holder, x, y) {
  for (const card of cardsIn(holder)) {
    const r = card.getBoundingClientRect();
    if (y < r.top - 6) { holder.insertBefore(indicator, card); return; }
    if (y <= r.bottom + 6 && x < r.left + r.width / 2) { holder.insertBefore(indicator, card); return; }
  }
  holder.appendChild(indicator);
}

function wireDropZone(holder) {
  holder.addEventListener("dragover", (e) => {
    if (!DRAG) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (holder.dataset.tier === "") indicator.remove(); // backlog: no slot, whole zone
    else placeIndicator(holder, e.clientX, e.clientY);
    holder.classList.add("drop-hot");
  });
  holder.addEventListener("dragleave", (e) => {
    if (!holder.contains(e.relatedTarget)) holder.classList.remove("drop-hot");
  });
  holder.addEventListener("drop", async (e) => {
    e.preventDefault();
    holder.classList.remove("drop-hot");
    if (!DRAG) return;
    const drag = DRAG;
    const targetTier = holder.dataset.tier;

    if (targetTier === "") {
      // dropped on the backlog → un-rate
      indicator.remove();
      if (!drag.fromBacklog && confirm("Remove this item from the board? Its review file will be deleted.")) {
        await api("DELETE", `/api/review?slug=${drag.slug}`);
        await refresh();
      }
      return;
    }

    // position = number of cards before the indicator
    let index = 0;
    for (const el of holder.children) {
      if (el === indicator) break;
      if (el.classList.contains("item-card") && !el.classList.contains("card-dragging")) index++;
    }
    indicator.remove();

    const ranking = structuredClone(ADMIN.ranking);
    for (const t of Object.keys(ranking)) ranking[t] = ranking[t].filter((s) => s !== drag.slug);
    ranking[targetTier].splice(index, 0, drag.slug);

    if (drag.fromBacklog) {
      const item = ADMIN.catalog.items[drag.code];
      await api("POST", "/api/review", {
        code: item.code,
        slug: item.slug,
        tags: [item.primaryCategory],
        date: today(),
      });
    }
    await api("POST", "/api/ranking", { ranking });
    await refresh();
    if (drag.fromBacklog) {
      const placed = DATA.rated.find((r) => r.slug === drag.slug);
      if (placed) openModal(placed); // straight into writing the notes
    }
  });
}

async function refresh() {
  await loadAll();
  render();
}

// ── modal ──

const modal = $("#modal");
$(".close", modal).addEventListener("click", () => modal.close());
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

function openModal(item) {
  const rated = DATA.rated.find((r) => r.slug === item.slug);
  const cat = ADMIN ? Object.values(ADMIN.catalog.items).find((i) => i.slug === item.slug) : item;
  const tier = rated ? DATA.tiers.find((t) => t.id === rated.tier) : null;

  const meta = [
    cat.calories ? `${cat.calories} cal` : null,
    cat.priceFormatted,
    cat.discontinued ? "☠ discontinued" : null,
  ].filter(Boolean).join(" · ");

  const tierChip = tier
    ? `<span class="modal-tier tier-chip-${tier.id}">${tier.id}${rated.rank} · ${esc(tier.name)}</span>`
    : `<span class="modal-tier modal-tier-unrated">unrated · drag it onto the board</span>`;

  let reviewHtml = "";
  if (rated) {
    reviewHtml = `
      <div class="tasting">
        <div class="t-head">reviewed ${esc(rated.date)}</div>
        ${ADMIN
          ? `<textarea class="t-edit" placeholder="the verdict...">${esc(rated.notes ?? "")}</textarea>`
          : rated.notes ? `<div class="t-notes">&ldquo;${esc(rated.notes)}&rdquo;</div>` : ""}
      </div>`;
  }

  const adminBar = ADMIN && rated ? `
    <div class="admin-bar">
      <button class="btn btn-save">Save</button>
    </div>` : "";

  $("#modal-body").innerHTML = `
    <img src="images/${cat.code}.jpg" alt="${esc(cat.name)}">
    <div class="modal-info">
      <h2>${esc(cat.name)}</h2>
      <div class="modal-meta">${esc(meta)}</div>
      ${tierChip}
      ${reviewHtml}
      ${adminBar}
    </div>`;

  if (ADMIN && rated) {
    const review = ADMIN.reviews[item.slug];
    $(".btn-save", modal).addEventListener("click", async () => {
      const notes = $(".t-edit", modal).value.trim();
      if (notes !== (review.notes ?? "")) review.date = today(); // re-reviewed
      review.notes = notes;
      await api("POST", "/api/review", review);
      ringBell();
      await refresh();
      modal.close();
    });
  }
  if (!modal.open) modal.showModal();
}

// ── boot ──

$(".bell-mark").addEventListener("click", ringBell);

await loadAll();
if (ADMIN) {
  const badge = document.createElement("div");
  badge.className = "admin-flag";
  badge.textContent = "ADMIN";
  document.body.appendChild(badge);
}
render();
