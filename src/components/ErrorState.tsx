import type { ReactNode } from "react";

import { Box } from "../atoms/Box";
import { Typo } from "../atoms/Typo";
import { spacing } from "../themes/theme";

import { AnimatedLoader } from "./AnimatedLoader";
import { ReloadButton } from "./ReloadButton";

type ErrorStateProps = {
  title?: string;
  message: string;
  hint?: ReactNode;
};

export const ErrorState = ({ title = "Une erreur est survenue", message, hint }: ErrorStateProps) => {
  return (
    <Box
      flex={1}
      justifyContent="center"
      alignItems="center"
      p="m"
    >
      <AnimatedLoader />
      <Box
        width="80%"
        borderRadius="base"
        backgroundColor="newTheme_surface"
        p="m"
      >
        {title ? (
          <Typo
            variant="paragraphe_regular"
            color="newTheme_danger"
          >
            {title}
          </Typo>
        ) : null}
        <Box style={{ marginTop: spacing.s }}>
          <Typo variant="paragraphe_regular">{message}</Typo>
        </Box>
        {hint ? (
          <Box style={{ marginTop: spacing.s }}>
            {typeof hint === "string" ? <Typo variant="paragraphe_regular">{hint}</Typo> : hint}
          </Box>
        ) : null}
        <Box style={{ marginTop: spacing.m }}>
          <ReloadButton />
        </Box>
      </Box>
    </Box>
  );
};
