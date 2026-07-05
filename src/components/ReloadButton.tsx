import { reloadAsync } from "expo-updates";
import React, { useCallback, useState } from "react";

import { Button } from "@atoms/Button";

type ReloadButtonProps = {
  label?: string;
};

export const ReloadButton: React.FC<ReloadButtonProps> = ({ label = "Redémarrer l'application" }) => {
  const [loading, setLoading] = useState(false);

  const handleReload = useCallback(async () => {
    try {
      setLoading(true);
      if (typeof window !== "undefined" && window.location?.reload) {
        window.location.reload();
        return;
      }
      await reloadAsync();
    } catch (error) {
      // En cas d'échec expo-updates, on tente un fallback navigateur si disponible
      if (typeof window !== "undefined" && window.location?.reload) {
        console.warn(
          "⚠️ Impossible de redémarrer l'application via expo-updates, fallback sur un simple rechargement de la page.",
          error,
        );
        window.location.reload();
      } else {
        console.error("❌ Impossible de redémarrer l'application :", error);
        setLoading(false);
      }
    }
  }, []);

  return (
    <Button
      label={label}
      leftIcon={{ name: "sync" }}
      onPress={handleReload}
      color="danger"
      loading={loading}
    />
  );
};
