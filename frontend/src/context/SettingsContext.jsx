import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getSettings, updateSettings as saveSettingsRequest } from "../services/settings";
import { contrastText } from "@shared/constants";

const CACHE_KEY = "site_settings";

const DEFAULT_SETTINGS = Object.freeze({
  theme_color: "#3b82f6",
  dark_mode: false,
});

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    if (parsed && HEX_PATTERN.test(parsed.theme_color ?? "")) {
      return {
        theme_color: parsed.theme_color,
        dark_mode: Boolean(parsed.dark_mode),
      };
    }
  } catch {
    // ignore malformed cache
  }

  return null;
}

function writeCache(settings) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota errors
  }
}

function normalize(settings) {
  return {
    theme_color: HEX_PATTERN.test(settings?.theme_color ?? "")
      ? settings.theme_color
      : DEFAULT_SETTINGS.theme_color,
    dark_mode: Boolean(settings?.dark_mode),
  };
}

// Applies the current theme (brand accent + light/dark) to <html>.
function applyTheme(settings) {
  const root = document.documentElement;

  root.dataset.theme = settings.dark_mode ? "dark" : "light";
  root.style.setProperty("--accent", settings.theme_color);
  root.style.setProperty("--accent-contrast", contrastText(settings.theme_color));
}

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const cached = readCache();
  const [settings, setSettings] = useState(cached || DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Keep the theme in sync with settings on every change (including
  // the initial cached/default values before the server responds).
  useEffect(() => {
    applyTheme(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await getSettings();

        if (active && data.success) {
          const next = normalize(data.settings);
          setSettings(next);
          writeCache(next);
        }
      } catch {
        // Keep showing cached/default theme when offline
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (next) => {
    const data = await saveSettingsRequest(next);

    if (data.success) {
      const normalized = normalize(data.settings);
      setSettings(normalized);
      writeCache(normalized);
    }

    return data;
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, save }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}