import React, { useEffect, useState } from "react";
import { TouchableOpacity, View } from "react-native";

import type { SelectionState } from "../utils/tree-selection";

import { Box } from "./Box";
import { Icon } from "./Icon";
import { Typo } from "./Typo";

const checkboxIconName = (state: SelectionState) => {
  if (state === "all") return "check-box" as const;
  if (state === "partial") return "indeterminate-check-box" as const;
  return "check-box-outline-blank" as const;
};

export type AccordionOpenedChangeOptions = {
  /** Alt/Option+clic : appliquer le même état à tous les sous-dossiers. */
  recursive?: boolean;
};

export type AccordionProps = {
  label: { text: string };
  /** Identifiant stable (path dossier) pour Option+clic. */
  accordionId?: string;
  tags?: React.ReactNode[];
  defaultOpened?: boolean;
  /** Contrôle l’ouverture (TreePanel). Absent = état interne. */
  opened?: boolean;
  onOpenedChange?: (nextOpened: boolean, options?: AccordionOpenedChangeOptions) => void;
  style?: { paddingBottom?: number };
  children: React.ReactNode;
  /** Affiche une checkbox et sépare expand (chevron) de la sélection (label + checkbox). */
  selectionMode?: boolean;
  selectionState?: SelectionState;
  onToggleSelect?: () => void;
};

export const Accordion: React.FC<AccordionProps> = ({
  label,
  accordionId,
  tags,
  defaultOpened = true,
  opened: openedProp,
  onOpenedChange,
  style,
  children,
  selectionMode = false,
  selectionState = "none",
  onToggleSelect,
}) => {
  const isControlled = openedProp !== undefined;
  const [uncontrolledOpened, setUncontrolledOpened] = useState(defaultOpened);
  const opened = isControlled ? openedProp : uncontrolledOpened;
  const headerId = accordionId || label.text;

  const toggleOpened = (recursive = false) => {
    const next = !opened;
    if (!isControlled) setUncontrolledOpened(next);
    onOpenedChange?.(next, recursive ? { recursive: true } : undefined);
  };

  /**
   * RN Web n’appelle pas `onPress` si `altKey` (Option macOS).
   * On écoute le `click` document — même événement que le navigateur reçoit.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onClick = (event: MouseEvent) => {
      if (!event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const host = target.closest("[data-vr-accordion]");
      if (host?.getAttribute("data-vr-accordion") !== headerId) return;
      event.preventDefault();
      event.stopPropagation();
      toggleOpened(true);
    };

    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [headerId, opened, isControlled, label.text, onOpenedChange]);

  const headerStyle = { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 8 };
  const tagsNode = tags ? <View style={{ flexDirection: "row", marginLeft: 8, gap: 4 }}>{tags}</View> : null;
  const expandHint = "Option+clic (Alt) pour ouvrir ou fermer tous les sous-dossiers";
  const headerDataProps = { dataSet: { vrAccordion: headerId } } as object;

  if (!selectionMode) {
    return (
      <View>
        <View {...headerDataProps}>
          <TouchableOpacity
            onPress={() => toggleOpened(false)}
            style={headerStyle}
            accessibilityRole="button"
            accessibilityState={{ expanded: opened }}
            accessibilityHint={expandHint}
          >
            <Icon
              name={opened ? "expand-more" : "chevron-right"}
              size="s"
              style={{ marginRight: 4 }}
            />
            <Typo variant="paragraphe_semiBold">{label.text}</Typo>
            {tagsNode}
          </TouchableOpacity>
        </View>
        {opened && <Box style={style}>{children}</Box>}
      </View>
    );
  }

  return (
    <View>
      <View
        style={headerStyle}
        {...headerDataProps}
      >
        <TouchableOpacity
          onPress={onToggleSelect}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: selectionState === "partial" ? "mixed" : selectionState === "all",
          }}
        >
          <Icon
            name={checkboxIconName(selectionState)}
            size="s"
            style={{ marginRight: 4 }}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => toggleOpened(false)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={opened ? "Réduire" : "Développer"}
          accessibilityHint={expandHint}
          accessibilityState={{ expanded: opened }}
        >
          <Icon
            name={opened ? "expand-more" : "chevron-right"}
            size="s"
            style={{ marginRight: 4 }}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onToggleSelect}
          style={{ flexShrink: 1 }}
          accessibilityRole="button"
        >
          <Typo variant="paragraphe_semiBold">{label.text}</Typo>
        </TouchableOpacity>
        {tagsNode}
      </View>
      {opened && <Box style={style}>{children}</Box>}
    </View>
  );
};
