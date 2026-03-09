module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./src"],
          alias: {
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
      "react-native-worklets/plugin",
    ],
  };
};
