/* eslint-disable import/no-default-export */
import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@atoms": path.resolve(__dirname, "src/atoms"),
      "@constants": path.resolve(__dirname, "src/constants"),
      "@components": path.resolve(__dirname, "src/components"),
      "@hooks": path.resolve(__dirname, "src/hooks"),
      "@locales": path.resolve(__dirname, "src/locales"),
      "@providers": path.resolve(__dirname, "src/providers"),
      "@scripts": path.resolve(__dirname, "src/scripts"),
      "@themes": path.resolve(__dirname, "src/themes"),
      "@app-types": path.resolve(__dirname, "src/types"),
      "@utils": path.resolve(__dirname, "src/utils"),
    },
  },
});
