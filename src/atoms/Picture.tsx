import React from "react";
import { Image, View } from "react-native";

const sizeMap = { s: 40, m: 64, xl: 96 };

export type PictureProps = {
  source?: { uri?: string };
  size?: "s" | "m" | "xl";
  contentFit?: "contain" | "cover";
};

export const Picture: React.FC<PictureProps> = ({ source, size = "m", contentFit = "contain" }) => {
  const s = sizeMap[size] ?? 64;
  if (!source?.uri) {
    return <View style={{ width: s, height: s, backgroundColor: "#eee", borderRadius: 4 }} />;
  }
  return (
    <Image
      source={{ uri: source.uri }}
      style={{ width: s, height: s, borderRadius: 4 }}
      resizeMode={contentFit}
    />
  );
};
