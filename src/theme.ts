/**
 * Thème minimal pour que le package soit indépendant (pas de dépendance au design system du projet hôte).
 */
export const spacing = {
  none: 0,
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
} as const;

export const colors = {
  newTheme_background: "#ffffff",
  newTheme_surface: "#f5f5f5",
  newTheme_neutral: "#e8e8e8",
  newTheme_border: "#ddd",
  newTheme_textOnSurface: "#1a1a1a",
  newTheme_textLegend: "#666",
  newTheme_textOnPrimary: "#fff",
  newTheme_primary: "#2563eb",
  newTheme_primary10: "#eff6ff",
  newTheme_primary80: "#3b82f6",
  newTheme_danger: "#dc2626",
  newTheme_warning: "#f59e0b",
  newTheme_info: "#0ea5e9",
  newTheme_fantasy: "#8b5cf6",
  newTheme_base: "#6b7280",
  newTheme_base10: "#9ca3af",
} as const;

export type SpacingKey = keyof typeof spacing;
export type ColorKey = keyof typeof colors;
