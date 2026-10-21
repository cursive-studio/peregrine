import type { APIRoute } from "astro";

// Every .astro page in src/pages becomes a sitemap entry.
// Add a path to `exclude` to keep a page out of search results.
const exclude = new Set<string>(["/404"]);

const pages = import.meta.glob("./**/*.astro", { eager: false });

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://peregrinecreativegroup.com");
  const lastmod = new Date().toISOString().split("T")[0];

  const paths = Object.keys(pages)
    .map((file) => file.replace(/^\.\//, "/").replace(/\.astro$/, "").replace(/\/index$/, "/").replace(/^\/index$/, "/"))
    .filter((path) => !path.includes("[") && !exclude.has(path))
    .map((path) => (path === "/" ? "/" : `${path}/`))
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));

  const urls = paths
    .map((path) => {
      const priority = path === "/" ? "1.0" : "0.8";
      return `  <url>\n    <loc>${new URL(path, base).href}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
