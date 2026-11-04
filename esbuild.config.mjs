import esbuild from "esbuild";
import { builtinModules } from "node:module";

const mode = process.argv[2];

if (mode === "preview") {
  // Browser harness: renders every screen with fake data (no Obsidian needed).
  const ctx = await esbuild.context({
    entryPoints: ["preview/preview.ts"],
    bundle: true,
    outfile: "preview/dist/preview.js",
    format: "iife",
    target: "es2020",
    sourcemap: "inline",
    logLevel: "info",
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: ".", port: Number(process.env.PORT ?? 5174) });
  console.log(`Preview: http://localhost:${port}/preview/`);
} else {
  const prod = mode === "production";
  const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    minify: prod,
    outfile: "main.js",
  });
  if (prod) {
    await ctx.rebuild();
    process.exit(0);
  } else {
    await ctx.watch();
  }
}
