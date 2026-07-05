import type { StorybookConfig } from "@storybook/react-webpack5";

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
        ],
        babelPlugins: ["react-native-reanimated/plugin"],
      },
    },
  ],
  framework: {
    name: "@storybook/react-webpack5",
    options: {},
  },
};

export default config;
