/**
 * Ouverture navigateur pour le launcher VR.
 * Sur macOS : n'ouvre que si l'URL (même origine) n'est pas déjà dans un onglet ;
 * si un onglet existe, on le met au premier plan.
 */
import { spawn, spawnSync } from "child_process";

/** Origine normalisée (localhost ≡ 127.0.0.1), sans slash final. */
export const normalizeBrowserOrigin = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname === "127.0.0.1" ? "localhost" : parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${host}${port}`;
  } catch {
    return null;
  }
};

const CHROMIUM_BROWSERS_MAC = [
  "Google Chrome",
  "Chromium",
  "Brave Browser",
  "Microsoft Edge",
  "Arc",
  "Vivaldi",
  "Opera",
] as const;

const MAC_TAB_CHECK_SCRIPT = `
on run argv
  set targetOrigin to item 1 of argv
  set chromiumBrowsers to {${CHROMIUM_BROWSERS_MAC.map(name => `"${name}"`).join(", ")}}

  repeat with browserName in chromiumBrowsers
    try
      if application browserName is running then
        tell application browserName
          set windowIndex to 0
          repeat with w in windows
            set windowIndex to windowIndex + 1
            set tabIndex to 0
            repeat with t in tabs of w
              set tabIndex to tabIndex + 1
              set tabUrl to URL of t
              if tabUrl starts with targetOrigin then
                set active tab index of w to tabIndex
                set index of w to 1
                activate
                return "yes"
              end if
            end repeat
          end repeat
        end tell
      end if
    end try
  end repeat

  try
    if application "Safari" is running then
      tell application "Safari"
        repeat with w in windows
          repeat with t in tabs of w
            set tabUrl to URL of t
            if tabUrl starts with targetOrigin then
              set current tab of w to t
              set index of w to 1
              activate
              return "yes"
            end if
          end repeat
        end repeat
      end tell
    end if
  end try

  return "no"
end run
`;

/** true si un onglet avec la même origine est déjà ouvert (et focalisé si possible). */
export const focusExistingBrowserTab = (url: string): boolean => {
  const origin = normalizeBrowserOrigin(url);
  if (!origin) return false;

  if (process.platform === "darwin") {
    const result = spawnSync("osascript", ["-", origin], {
      input: MAC_TAB_CHECK_SCRIPT,
      encoding: "utf8",
      timeout: 8_000,
    });
    if (result.error || result.status !== 0) return false;
    return (result.stdout || "").trim() === "yes";
  }

  // Windows / Linux : pas de détection d'onglets fiable sans CDP navigateur.
  return false;
};

const spawnDetached = (cmd: string, args: string[]): void => {
  const child = spawn(cmd, args, {
    stdio: "ignore",
    detached: true,
    shell: false,
  });
  child.unref();
};

export const openUrlInBrowser = (url: string): void => {
  if (process.platform === "darwin") {
    spawnDetached("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    spawnDetached("cmd", ["/c", "start", "", url]);
    return;
  }
  spawnDetached("xdg-open", [url]);
};

export type OpenBrowserIfNeededResult = "focused" | "opened" | "skipped-error";

/**
 * Focalise un onglet existant (même origine) ou ouvre l'URL dans le navigateur.
 */
export const openInBrowserIfNeeded = (url: string): OpenBrowserIfNeededResult => {
  try {
    if (focusExistingBrowserTab(url)) {
      return "focused";
    }
    openUrlInBrowser(url);
    return "opened";
  } catch {
    return "skipped-error";
  }
};
