import React from "react";
import { ActivityIndicator, Image } from "react-native";

import type { StoryScreenshotsPath } from "@app-types/types";
import { Box } from "@atoms/Box";
import { Typo } from "@atoms/Typo";
import { AnimatedLoader } from "@components/AnimatedLoader";
import { DraggableImageCompare } from "@components/DraggableImageCompare";
import { ScreenshotDetails } from "@components/ScreenshotDetails";
import { useDeviceConfig } from "@providers/DeviceConfigProvider";
import { colors } from "@themes/theme";

export type ContentPanelProps = {
  tree: unknown;
  treeType: "new" | "diff";
  showHeatmap: boolean;
  imageUrls: StoryScreenshotsPath;
  isRegenerating?: boolean;
  storyId?: string;
  deviceName?: string;
  /** Force le remontage des images quand l'index serveur change. */
  contentKey?: string;
  /** Si le chargement de l'arbre a échoué (ex. serveur VR injoignable). */
  fetchError?: string | null;
};

export const ContentPanel: React.FC<ContentPanelProps> = ({
  tree,
  treeType,
  showHeatmap,
  imageUrls,
  isRegenerating = false,
  storyId,
  deviceName,
  contentKey,
  fetchError = null,
}) => {
  const { getDeviceStyle } = useDeviceConfig();

  if (!tree) {
    return (
      <Box
        flex={1}
        minHeight={280}
        alignItems="center"
        justifyContent="center"
        gap="m"
        backgroundColor="newTheme_neutral"
        borderRadius="base"
        borderWidth={1}
        borderColor="newTheme_border"
        p="l"
      >
        {fetchError ? (
          <>
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              Impossible de charger l'arbre des régressions
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              {fetchError}
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              Vérifie que le serveur VR tourne (yarn vr:server ou yarn vr) sur le port 2805.
            </Typo>
          </>
        ) : (
          <>
            <AnimatedLoader />
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              Aucune régression détectée, ni nouvelle screenshot
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
            >
              Lance la comparaison initiale (yarn vr) ou utilise le bouton "Rafraîchir" après avoir généré des
              screenshots.
            </Typo>
          </>
        )}
      </Box>
    );
  }

  if (isRegenerating) {
    const deviceColor = deviceName
      ? colors[getDeviceStyle(deviceName).color as keyof typeof colors]
      : colors.newTheme_fantasy;
    return (
      <Box
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="m"
        backgroundColor="newTheme_neutral"
        borderRadius="base"
        borderWidth={1}
        borderColor="newTheme_border"
      >
        <AnimatedLoader />
        <ActivityIndicator
          size="large"
          color={deviceColor}
        />
        <Box gap="s">
          <Typo
            variant="paragraphe_regular"
            textAlign="center"
          >
            Régénération de l'image en cours...
          </Typo>
          <ScreenshotDetails
            deviceName={deviceName}
            storyId={storyId}
            bold
          />
        </Box>
      </Box>
    );
  }

  const hasNewImage = treeType === "new" && imageUrls.new;
  const hasDiffImage = treeType === "diff" && (showHeatmap ? imageUrls.diff : imageUrls.original || imageUrls.temp);

  if (!hasNewImage && !hasDiffImage) {
    return (
      <Box
        flex={1}
        minHeight={280}
        alignItems="center"
        justifyContent="center"
        gap="m"
        backgroundColor="newTheme_neutral"
        borderRadius="base"
        borderWidth={1}
        borderColor="newTheme_border"
        p="l"
      >
        <Typo
          variant="h2_semiBold"
          color="newTheme_textOnSurface"
        >
          Aucune image à afficher
        </Typo>
        <Typo
          variant="paragraphe_regular"
          color="newTheme_textOnSurface"
        >
          Sélectionne un élément dans l'arbre à gauche pour comparer ou afficher la capture.
        </Typo>
      </Box>
    );
  }

  return (
    <Box
      key={contentKey}
      flex={1}
    >
      {treeType === "new" && imageUrls.new && (
        <Box
          flex={1}
          gap="s"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          borderWidth={1}
          borderColor="newTheme_border"
          style={{ padding: 2 }}
        >
          <Box
            flex={1}
            alignItems="center"
            justifyContent="center"
          >
            <Image
              key={imageUrls.new}
              source={{ uri: imageUrls.new }}
              style={{ width: "100%", height: "100%", resizeMode: "contain" }}
            />
          </Box>
        </Box>
      )}
      {treeType === "diff" && showHeatmap && imageUrls.diff && (
        <Box
          flex={1}
          gap="s"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          borderWidth={1}
          borderColor="newTheme_border"
          style={{ padding: 2 }}
        >
          <Box
            flex={1}
            alignItems="center"
            justifyContent="center"
          >
            <Image
              key={imageUrls.diff}
              source={{ uri: imageUrls.diff }}
              style={{ width: "100%", height: "100%", resizeMode: "contain" }}
            />
          </Box>
        </Box>
      )}
      {treeType === "diff" && !showHeatmap && (
        <Box
          flex={1}
          gap="s"
          backgroundColor="newTheme_neutral"
          borderRadius="base"
          borderWidth={1}
          borderColor="newTheme_border"
          style={{ padding: 2 }}
        >
          <React.Fragment key={`${imageUrls.original || ""}-${imageUrls.temp || ""}-${contentKey || ""}`}>
            <DraggableImageCompare
              key={contentKey}
              leftImage={imageUrls.original}
              rightImage={imageUrls.temp}
            />
          </React.Fragment>
        </Box>
      )}
    </Box>
  );
};
