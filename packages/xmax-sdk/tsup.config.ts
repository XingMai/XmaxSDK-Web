import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "react/index": "src/react/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  external: ["react", "react/jsx-runtime"],
  target: "es2020",
  noExternal: ["framegen"],
});
