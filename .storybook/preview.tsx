import type { Preview } from "@storybook/react-webpack5";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "react-native-reanimated";

const preview: Preview = {
  decorators: [
    Story => (
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Story />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    ),
  ],
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
