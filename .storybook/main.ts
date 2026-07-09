import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-webpack5";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/demo/**/*.stories.@(ts|tsx|js|jsx)"],
  addons: [
    {
      name: "@storybook/addon-react-native-web",
      options: {
        modulesToTranspile: [
          "react-native-reanimated",
          "react-native-gesture-handler",
          "react-native-safe-area-context",
          "react-native-svg",
          "@expo/vector-icons",
          "@setshao/visual-regression",
        ],
        babelPlugins: ["react-native-reanimated/plugin"],
      },
    },
  ],
  framework: {
    name: "@storybook/react-webpack5",
    options: {},
  },
  webpackFinal: async config => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@setshao/visual-regression": path.join(packageRoot, "../src/index.ts"),
      "@setshao/visual-regression/storybook": path.join(packageRoot, "../src/storybook/index.ts"),
    };
    return config;
  },
};

export default config;
