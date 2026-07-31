const appBuild = await Bun.build({
  entrypoints: [new URL("./app.ts", import.meta.url).pathname],
  target: "browser",
  minify: process.env.NODE_ENV === "production",
  sourcemap: "linked",
});

if (!appBuild.success) {
  for (const log of appBuild.logs) console.error(log);
  throw new Error("Failed to build the Egeria browser client");
}

const app = appBuild.outputs.find((output) => output.path.endsWith("app.js"));
const sourceMap = appBuild.outputs.find((output) => output.path.endsWith("app.js.map"));

if (!app) throw new Error("Browser build did not produce app.js");

const html = Bun.file(new URL("./index.html", import.meta.url));
const css = Bun.file(new URL("./styles.css", import.meta.url));
const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  routes: {
    "/": new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    "/app.js": new Response(await app.arrayBuffer(), {
      headers: { "content-type": "text/javascript; charset=utf-8" },
    }),
    "/app.js.map": new Response(sourceMap ? await sourceMap.arrayBuffer() : "", {
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    "/styles.css": new Response(css, {
      headers: { "content-type": "text/css; charset=utf-8" },
    }),
    "/runtime-config": Response.json({
      agentOsEndpoint: process.env.AGENTOS_PUBLIC_ENDPOINT ?? null,
      vmId: process.env.AGENTOS_VM_ID ?? "egeria-browser",
    }),
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Egeria web workspace listening on port ${port}`);
