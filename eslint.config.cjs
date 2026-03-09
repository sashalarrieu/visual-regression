// https://docs.expo.dev/guides/using-eslint/
// ESLint v9 flat configuration format

const path = require("path");

const { fixupConfigRules, fixupPluginRules } = require("@eslint/compat");
const { FlatCompat } = require("@eslint/eslintrc");
const pluginJs = require("@eslint/js");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const typescriptParser = require("@typescript-eslint/parser");
const prettierConfig = require("eslint-config-prettier");
const checkFilePlugin = require("eslint-plugin-check-file");
const importHelpersPlugin = require("eslint-plugin-import-helpers");
const prettierPlugin = require("eslint-plugin-prettier");

const aliasEnforcerPlugin = require("./eslint-plugin-alias-enforcer.cjs");

const compat = new FlatCompat({
  baseDirectory: path.resolve(),
  resolvePluginsRelativeTo: path.resolve(),
});

module.exports = [
  // Base JavaScript recommended rules
  pluginJs.configs.recommended,

  // Prettier config to disable conflicting rules
  prettierConfig,

  // Convert eslint-config-expo to flat config
  ...fixupConfigRules(compat.extends("expo")),

  // Convert storybook config to flat config
  ...fixupConfigRules(compat.extends("plugin:storybook/recommended")),

  // Convert React Hooks rules
  ...fixupConfigRules(compat.extends("plugin:react-hooks/recommended")),

  // Convert import plugin rules
  ...fixupConfigRules(compat.extends("plugin:import/recommended")),
  ...fixupConfigRules(compat.extends("plugin:import/typescript")),

  // TypeScript configuration
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": fixupPluginRules(typescriptEslint),
      prettier: fixupPluginRules(prettierPlugin),
    },
    rules: {
      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unused-vars": "error",
      // Use standard prefer-const rule instead of TypeScript-specific one
      "prefer-const": "error",
      // Enable Prettier integration with project options
      "prettier/prettier": [
        "error",
        {
          singleAttributePerLine: true,
        },
      ],
    },
  },

  // Main configuration for JavaScript and TypeScript
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx,gql,sql}"],
    plugins: {
      "check-file": fixupPluginRules(checkFilePlugin),
      prettier: fixupPluginRules(prettierPlugin),
      "import-helpers": fixupPluginRules(importHelpersPlugin),
      "alias-enforcer": aliasEnforcerPlugin,
    },
    rules: {
      // Enable Prettier integration with project options
      "prettier/prettier": [
        "error",
        {
          singleAttributePerLine: true,
        },
      ],

      // Remove max-len since Prettier handles line length
      // "max-len" rule conflicts with Prettier, so we remove it

      // Max lines per file - UI components: 700, logic files: 1000
      "max-lines": [
        "error",
        {
          max: 1000,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      "no-multiple-empty-lines": [
        "error",
        {
          max: 1,
          maxEOF: 0,
          maxBOF: 0,
        },
      ],

      // React rules
      "react/jsx-wrap-multilines": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react/jsx-one-expression-per-line": "off",
      // Let Prettier handle props-per-line formatting
      "react/jsx-max-props-per-line": "off",

      // Remove useless brackets for props
      "react/jsx-curly-brace-presence": [
        "error",
        {
          props: "never",
          children: "never",
        },
      ],

      // // File and folder naming conventions
      // "check-file/filename-naming-convention": [
      //   "error",
      //   {
      //     "**/*.{js,ts,jsx,tsx}": "camelCase",
      //   },
      //   {
      //     ignoreMiddleExtensions: true,
      //   },
      // ],
      // "check-file/folder-naming-convention": [
      //   "error",
      //   {
      //     "src/**/": "PascalCase",
      //   },
      // ],

      "comma-dangle": "off",
      curly: "off",
      camelcase: "off",
      "no-empty-interface": "off",
      "no-empty-function": "off",
      eqeqeq: "error",

      "import/no-default-export": "error",
      "import/named": "error",
      "import/namespace": "error",
      "import/default": "error",
      "import/export": "error",

      // Forcer l'utilisation des alias quand c'est possible
      "import/no-relative-packages": "error",

      // Règle personnalisée pour forcer les alias
      "alias-enforcer/enforce-aliases": [
        "error",
        {
          aliases: {
            "@atoms": "./src/atoms",
            "@constants": "./src/constants",
            "@components": "./src/components",
            "@hooks": "./src/hooks",
            "@locales": "./src/locales",
            "@providers": "./src/providers",
            "@scripts": "./src/scripts",
            "@themes": "./src/themes",
            "@app-types": "./src/types",
            "@utils": "./src/utils",
          },
        },
      ],

      // Trier les imports par groupes avec les alias en premier
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal", // Pour les alias @*
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
    },
  },

  // Specific rules for UI components (components, atoms, screens)
  {
    files: ["**/components/**/*.{js,jsx,ts,tsx}", "**/atoms/**/*.{js,jsx,ts,tsx}", "**/screens/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "max-lines": [
        "error",
        {
          max: 700,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },

  // Allow default exports in app folder / Storybook files (convention Storybook pour la meta)
  {
    files: ["**/*.stories.{js,jsx,ts,tsx}", "src/index.tsx"],
    rules: {
      "import/no-default-export": "off",
    },
  },

  // Remove JSX-specific overrides to prevent conflicts with Prettier

  // Ignored files
  {
    ignores: ["dist/*", "node_modules/*", "web-build/*", "bin/*"],
  },
];
