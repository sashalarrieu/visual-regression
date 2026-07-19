import React from "react";
import { ActivityIndicator, Image } from "react-native";

import { Box } from "../atoms/Box";
import { Button } from "../atoms/Button";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { colors } from "../themes/theme";
import type { StoryScreenshotsPath } from "../types/types";

import { AnimatedLoader } from "./AnimatedLoader";
import { DraggableImageCompare } from "./DraggableImageCompare";
import { ScreenshotDetails } from "./ScreenshotDetails";

export type ContentPanelMode = "new" | "diff" | "baseline" | "missing";

export type ContentPanelProps = {
  tree: unknown;
  treeType: "new" | "diff";
  /** Mode d'affichage explicite (catalogue baseline/missing). */
  panelMode?: ContentPanelMode;
  showHeatmap: boolean;
  imageUrls: StoryScreenshotsPath;
  isRegenerating?: boolean;
  storyId?: string;
  deviceName?: string;
  /** Force le remontage des images quand l'index serveur change. */
  contentKey?: string;
  /** Si le chargement de l'arbre a échoué (ex. serveur VR injoignable). */
  fetchError?: string | null;
  /** Chargement en cours (catalogue / régressions). */
  loading?: boolean;
  ignored?: boolean;
  onGenerate?: () => void;
};

export const ContentPanel: React.FC<ContentPanelProps> = ({
  tree,
  treeType,
  panelMode,
  showHeatmap,
  imageUrls,
  isRegenerating = false,
  storyId,
  deviceName,
  contentKey,
  fetchError = null,
  loading = false,
  ignored = false,
  onGenerate,
}) => {
  const { getDeviceStyle } = useDeviceConfig();
  const mode: ContentPanelMode = panelMode ?? treeType;
  const isCatalogMode = mode === "baseline" || mode === "missing";

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
        {fetchError && !loading ? (
          <>
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              Impossible de charger l'arbre
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
        ) : loading ? (
          <>
            <AnimatedLoader />
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              {isCatalogMode ? "Chargement du catalogue Storybook…" : "Chargement…"}
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              {isCatalogMode
                ? "L'index Storybook peut arriver après l'ouverture de l'UI — nouvelle tentative automatique."
                : "Récupération de l'arbre des régressions…"}
            </Typo>
          </>
        ) : isCatalogMode ? (
          <>
            <AnimatedLoader />
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              Aucune story à afficher
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              Storybook n'a indexé aucune story éligible. Vérifie Storybook puis utilise le bouton Rafraîchir.
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

  if (mode === "missing") {
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
        {ignored ? (
          <>
            <Box pb="l">
              <ScreenshotDetails
                deviceName={deviceName}
                storyId={storyId}
                bold
              />
            </Box>
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              Story ignorée (ignore-vr)
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              Cette story est taguée ignore-vr : la génération de capture est désactivée.
            </Typo>
          </>
        ) : (
          <>
            <Box pb="l">
              <ScreenshotDetails
                deviceName={deviceName}
                storyId={storyId}
                bold
              />
            </Box>
            <Typo
              variant="h2_semiBold"
              color="newTheme_textOnSurface"
            >
              Aucun screenshot pour cette story
            </Typo>
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              Génère une capture pour créer la baseline sur ce device.
            </Typo>
            <Button
              label="Générer une capture"
              leftIcon={{ name: "add", fill: "newTheme_textOnPrimary" }}
              color="primary"
              onPress={() => onGenerate?.()}
              disabled={!onGenerate}
            />
          </>
        )}
      </Box>
    );
  }

  if (mode === "baseline" && imageUrls.original) {
    return (
      <Box
        key={contentKey}
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
            key={imageUrls.original}
            source={{ uri: imageUrls.original }}
            style={{ width: "100%", height: "100%", resizeMode: "contain" }}
          />
        </Box>
      </Box>
    );
  }

  const hasNewImage = mode === "new" && imageUrls.new;
  const hasDiffImage = mode === "diff" && (showHeatmap ? imageUrls.diff : imageUrls.original || imageUrls.temp);

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
      {mode === "new" && imageUrls.new && (
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
      {mode === "diff" && showHeatmap && imageUrls.diff && (
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
      {mode === "diff" && !showHeatmap && (
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
