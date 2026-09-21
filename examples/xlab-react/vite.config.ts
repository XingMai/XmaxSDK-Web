import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 开发时直接使用包源码，无需先构建 SDK。
      "@xmaxai/web-sdk/react": fileURLToPath(
        new URL("../../packages/xmax-sdk/src/react/index.ts", import.meta.url),
      ),
      "@xmaxai/web-sdk": fileURLToPath(
        new URL("../../packages/xmax-sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 7100,
    strictPort: false,
  },
});
