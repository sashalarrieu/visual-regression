/**
 * Config des devices pour la régression visuelle.
 * Utilisée par : vr-server, compare-visual-regressions, et l'UI @setshao/visual-regression.
 * Chaque device doit définir : name, viewport, deviceScaleFactor?, isMobile?, label, icon, color.
 * icon : nom MaterialIcons (@expo/vector-icons), ex. "laptop", "tablet".
 */
module.exports = [
  {
    name: "desktop-fhd",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    label: "Desktop FHD",
    icon: "laptop",
    color: "newTheme_primary",
  },
  {
    name: "iphone16",
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    label: "iPhone 16",
    icon: "phone-iphone",
    color: "newTheme_fantasy",
  },
  {
    name: "ipad-a16-portrait",
    viewport: { width: 834, height: 1194 },
    deviceScaleFactor: 2,
    isMobile: true,
    label: "iPad A16 Portrait",
    icon: "tablet-mac",
    color: "newTheme_warning",
  },
  {
    name: "ipad-a16-landscape",
    viewport: { width: 1194, height: 834 },
    deviceScaleFactor: 2,
    isMobile: true,
    label: "iPad A16 Paysage",
    icon: "tablet",
    color: "newTheme_info",
  },
];
