/**
 * Point d'entrée de l'app Expo standalone pour @setshao/visual-regression.
 * Utilisé uniquement quand on lance l'interface via `visual-regression app`
 * (Expo est démarré depuis la racine du package, pas depuis le projet hôte).
 */
import { registerRootComponent } from "expo";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { VisualRegressions } from "./VisualRegressions";

const App = () => (
  <SafeAreaProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <VisualRegressions />
    </GestureHandlerRootView>
  </SafeAreaProvider>
);

registerRootComponent(App);
