import type { Preview } from "@storybook/react-webpack5";

import { vrPreviewDecorators } from "@setshao/visual-regression/storybook";

const preview: Preview = {
  decorators: vrPreviewDecorators,
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
