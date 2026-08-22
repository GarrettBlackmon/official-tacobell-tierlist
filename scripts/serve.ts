// Tiny static server for local dev:  bun run dev
const ROOT = new URL("../site/", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4173);

const types: Record<string, string> = {
  html: "text/html", css: "text/css", js: "text/javascript",
  json: "application/json", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml",
  mp3: "audio/mpeg",
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/") path = "/index.html";
    const file = Bun.file(ROOT + path.slice(1));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const ext = path.split(".").pop() ?? "";
    return new Response(file, { headers: { "content-type": types[ext] ?? "application/octet-stream" } });
  },
});
console.log(`Serving site/ at http://localhost:${PORT}`);
