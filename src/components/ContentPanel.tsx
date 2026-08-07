import React from "react";
import { ActivityIndicator, Image } from "react-native";

import { Box } from "../atoms/Box";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { Typo } from "../atoms/Typo";
import { useDeviceConfig } from "../providers/DeviceConfigProvider";
import { colors } from "../themes/theme";
import type { StoryScreenshotsPath, StoryType } from "../types/types";
import type { TreePanelMode } from "../utils";

import { AnimatedLoader } from "./AnimatedLoader";
import { DraggableImageCompare } from "./DraggableImageCompare";
import { ScreenshotDetails } from "./ScreenshotDetails";

export type ContentPanelProps = {
  /** Onglet actif — viewer catalogue / orphelins. */
  mode?: TreePanelMode;
  tree: unknown;
  /** Statut du fichier sélectionné (régressions / catalogue / orphelins). */
  storyType?: StoryType;
  /** Alias régressions : `new` | `diff` (dérivé de storyType si omis). */
  treeType?: "new" | "diff";
  showHeatmap: boolean;
  imageUrls: StoryScreenshotsPath;
  isRegenerating?: boolean;
  storyId?: string;
  deviceName?: string;
  /** Force le remontage des images quand l'index serveur change. */
  contentKey?: string;
  /** Si le chargement de l'arbre a échoué (ex. serveur VR injoignable). */
  fetchError?: string | null;
  /** Catalogue : story taguée ignore-vr (Générer désactivé). */
  ignored?: boolean;
  /** Catalogue missing : lancer une capture. */
  onGenerate?: () => void;
};

const ImageFrame: React.FC<{ contentKey?: string; uri: string }> = ({ contentKey, uri }) => (
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
        key={`${contentKey ?? ""}-${uri}`}
        source={{ uri }}
        style={{ width: "100%", height: "100%", resizeMode: "contain" }}
      />
    </Box>
  </Box>
);

const EmptyPanel: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
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
      textAlign="center"
    >
      {title}
    </Typo>
    {children}
  </Box>
);

export const ContentPanel: React.FC<ContentPanelProps> = ({
  mode = "regressions",
  tree,
  storyType,
  treeType,
  showHeatmap,
  imageUrls,
  isRegenerating = false,
  storyId,
  deviceName,
  contentKey,
  fetchError = null,
  ignored = false,
  onGenerate,
}) => {
  const { getDeviceStyle } = useDeviceConfig();
  const effectiveType: StoryType = storyType ?? (treeType === "diff" ? "diff" : "new");

  if (!tree) {
    const emptyTitle =
      mode === "all-stories"
        ? "Aucune story dans le catalogue"
        : mode === "orphans"
          ? "Aucun orphelin"
          : fetchError
            ? "Impossible de charger l'arbre des régressions"
            : "Aucune régression détectée, ni nouvelle screenshot";

    return (
      <EmptyPanel title={emptyTitle}>
        {fetchError ? (
          <>
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
        ) : mode === "all-stories" ? (
          <Typo
            variant="paragraphe_regular"
            color="newTheme_textOnSurface"
            textAlign="center"
          >
            Vérifie que Storybook est démarré et que l'index est accessible.
          </Typo>
        ) : mode === "orphans" ? (
          <Typo
            variant="paragraphe_regular"
            color="newTheme_textOnSurface"
            textAlign="center"
          >
            Tous les screenshots disque correspondent à une story Storybook.
          </Typo>
        ) : (
          <Typo
            variant="paragraphe_regular"
            color="newTheme_textOnSurface"
            textAlign="center"
          >
            Lance la comparaison initiale (yarn vr) ou utilise le bouton "Rafraîchir" après avoir généré des
            screenshots.
          </Typo>
        )}
      </EmptyPanel>
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

  // --- Catalogue : baseline viewer / missing + Générer ---
  if (mode === "all-stories") {
    if (effectiveType === "baseline" && imageUrls.original) {
      return (
        <Box
          key={contentKey}
          flex={1}
        >
          <ImageFrame
            contentKey={contentKey}
            uri={imageUrls.original}
          />
        </Box>
      );
    }

    if (effectiveType === "missing" || (effectiveType === "baseline" && !imageUrls.original)) {
      return (
        <EmptyPanel title={ignored ? "Story ignorée (ignore-vr)" : "Capture absente"}>
          {ignored ? (
            <>
              <Icon
                name="block"
                fill="newTheme_base10"
                size="l"
              />
              <Typo
                variant="paragraphe_regular"
                color="newTheme_textOnSurface"
                textAlign="center"
              >
                Cette story est taguée ignore-vr. La génération est désactivée.
              </Typo>
            </>
          ) : (
            <Typo
              variant="paragraphe_regular"
              color="newTheme_textOnSurface"
              textAlign="center"
            >
              Aucune baseline sur disque pour ce device. Génère une capture pour l'ajouter au catalogue.
            </Typo>
          )}
          <Button
            label="Générer une capture"
            color="primary"
            width={200}
            leftIcon={{ name: "add-a-photo" }}
            onPress={() => onGenerate?.()}
            disabled={ignored || !onGenerate}
          />
        </EmptyPanel>
      );
    }

    return (
      <EmptyPanel title="Aucune image à afficher">
        <Typo
          variant="paragraphe_regular"
          color="newTheme_textOnSurface"
          textAlign="center"
        >
          Sélectionne une story dans l'arbre à gauche.
        </Typo>
      </EmptyPanel>
    );
  }

  // --- Orphelins : afficher l'image disponible (pas de heatmap) ---
  if (mode === "orphans") {
    if (effectiveType === "new" && imageUrls.new) {
      return (
        <Box
          key={contentKey}
          flex={1}
        >
          <ImageFrame
            contentKey={contentKey}
            uri={imageUrls.new}
          />
        </Box>
      );
    }

    if (effectiveType === "baseline" && imageUrls.original) {
      return (
        <Box
          key={contentKey}
          flex={1}
        >
          <ImageFrame
            contentKey={contentKey}
            uri={imageUrls.original}
          />
        </Box>
      );
    }

    if (effectiveType === "diff") {
      if (imageUrls.original && imageUrls.temp) {
        return (
          <Box
            key={contentKey}
            flex={1}
          >
            <Box
              flex={1}
              gap="s"
              backgroundColor="newTheme_neutral"
              borderRadius="base"
              borderWidth={1}
              borderColor="newTheme_border"
              style={{ padding: 2 }}
            >
              <React.Fragment key={`${imageUrls.original}-${imageUrls.temp}-${contentKey || ""}`}>
                <DraggableImageCompare
                  key={contentKey}
                  leftImage={imageUrls.original}
                  rightImage={imageUrls.temp}
                />
              </React.Fragment>
            </Box>
          </Box>
        );
      }
      const orphanDiffUri = imageUrls.diff || imageUrls.original || imageUrls.temp;
      if (orphanDiffUri) {
        return (
          <Box
            key={contentKey}
            flex={1}
          >
            <ImageFrame
              contentKey={contentKey}
              uri={orphanDiffUri}
            />
          </Box>
        );
      }
    }

    const fallbackUri = imageUrls.new || imageUrls.original || imageUrls.diff || imageUrls.temp;
    if (fallbackUri) {
      return (
        <Box
          key={contentKey}
          flex={1}
        >
          <ImageFrame
            contentKey={contentKey}
            uri={fallbackUri}
          />
        </Box>
      );
    }

    return (
      <EmptyPanel title="Aucune image à afficher">
        <Typo
          variant="paragraphe_regular"
          color="newTheme_textOnSurface"
          textAlign="center"
        >
          Sélectionne un orphelin dans l'arbre à gauche.
        </Typo>
      </EmptyPanel>
    );
  }

  // --- Régressions (comportement historique) ---
  const regressionType: "new" | "diff" = effectiveType === "diff" ? "diff" : "new";
  const hasNewImage = regressionType === "new" && imageUrls.new;
  const hasDiffImage =
    regressionType === "diff" && (showHeatmap ? imageUrls.diff : imageUrls.original || imageUrls.temp);

  if (!hasNewImage && !hasDiffImage) {
    return (
      <EmptyPanel title="Aucune image à afficher">
        <Typo
          variant="paragraphe_regular"
          color="newTheme_textOnSurface"
          textAlign="center"
        >
          Sélectionne un élément dans l'arbre à gauche pour comparer ou afficher la capture.
        </Typo>
      </EmptyPanel>
    );
  }

  return (
    <Box
      key={contentKey}
      flex={1}
    >
      {regressionType === "new" && imageUrls.new && (
        <ImageFrame
          contentKey={contentKey}
          uri={imageUrls.new}
        />
      )}
      {regressionType === "diff" && showHeatmap && imageUrls.diff && (
        <ImageFrame
          contentKey={contentKey}
          uri={imageUrls.diff}
        />
      )}
      {regressionType === "diff" && !showHeatmap && (
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
