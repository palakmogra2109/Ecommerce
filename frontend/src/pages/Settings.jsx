import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import {
  contrastText,
  THEME_COLOR_PRESETS,
  THEME_MODES,
} from "@shared/constants";

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export default function Settings() {
  const { settings, loading, save } = useSettings();
  const { can } = useAuth();
  const canUpdateSettings = can("settings.update");

  const [themeColor, setThemeColor] = useState(settings.theme_color);
  const [mode, setMode] = useState(
    settings.dark_mode ? THEME_MODES.DARK : THEME_MODES.LIGHT
  );
  const [hexInput, setHexInput] = useState(settings.theme_color);
  const [hexError, setHexError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Re-sync local state when server settings finish loading/changing.
  useEffect(() => {
    setThemeColor(settings.theme_color);
    setHexInput(settings.theme_color);
    setMode(settings.dark_mode ? THEME_MODES.DARK : THEME_MODES.LIGHT);
    setHexError("");
    setMessage("");
  }, [settings]);

  function handleHexChange(e) {
    const value = e.target.value;

    setHexInput(value);

    if (HEX_PATTERN.test(value)) {
      setThemeColor(value.toLowerCase());
      setHexError("");
    } else {
      setHexError("Enter a valid hex color, e.g. #3b82f6");
    }
  }

  function handlePresetClick(color) {
    setThemeColor(color);
    setHexInput(color);
    setHexError("");
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      const next = {
        theme_color: themeColor,
        dark_mode: mode === THEME_MODES.DARK,
      };

      const data = await save(next);

      setMessage(
        data.success
          ? "Settings saved successfully"
          : data.message || "Unable to save settings"
      );
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const onPrimary = contrastText(themeColor);
  const isDark = mode === THEME_MODES.DARK;

  return (
    <div className="filament-page">
      <Breadcrumb items={[{ label: "Settings" }]} />

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Settings</h1>
          </div>
          <div className="filament-card-header-right">
            {message && (
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: message === "Settings saved successfully"
                    ? "#16a34a"
                    : "#dc2626",
                }}
              >
                {message}
              </span>
            )}
            {canUpdateSettings && (
              <button
                type="button"
                className="filament-btn filament-btn-primary"
                disabled={saving || !!hexError || loading}
                onClick={handleSave}
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <div className="settings-layout" style={{ padding: "1.5rem" }}>
            {/* =====================================
                APPEARANCE
            ====================================== */}
            <div className="settings-panel">
              <h2>Appearance</h2>
              <p>
                Choose a brand color and theme mode. The brand color is used
                across the whole admin panel and in email templates.
              </p>

              <div className="settings-theme-toggle">
                <button
                  type="button"
                  className={`settings-theme-option${
                    !isDark ? " settings-theme-option-active" : ""
                  }`}
                  onClick={() => setMode(THEME_MODES.LIGHT)}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.38 5.38 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.54-9.38A9.03 9.03 0 0 0 12 3z" />
                  </svg>
                  Light
                </button>
                <button
                  type="button"
                  className={`settings-theme-option${
                    isDark ? " settings-theme-option-active" : ""
                  }`}
                  onClick={() => setMode(THEME_MODES.DARK)}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3a9 9 0 0 0 0 18c1.36 0 2.66-.3 3.82-.84A6.99 6.99 0 0 1 12 6a9 9 0 0 0 0-3z" />
                  </svg>
                  Dark
                </button>
              </div>

              <div className="settings-color-presets">
                {THEME_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`settings-swatch${
                      themeColor === color
                        ? " settings-swatch-selected"
                        : ""
                    }`}
                    style={{ background: color }}
                    title={color}
                    onClick={() => handlePresetClick(color)}
                    aria-label={`Use ${color}`}
                  />
                ))}
              </div>

              <div className="settings-color-input-row">
                <input
                  type="color"
                  value={themeColor}
                  onChange={(e) => {
                    const value = e.target.value;
                    setThemeColor(value);
                    setHexInput(value);
                    setHexError("");
                  }}
                  aria-label="Custom color"
                />
                <input
                  type="text"
                  className="filament-search-input"
                  style={{
                    width: "7.5rem",
                    height: "2.25rem",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "0.5rem",
                    padding: "0 0.75rem",
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                  value={hexInput}
                  onChange={handleHexChange}
                  maxLength={7}
                  placeholder="#3b82f6"
                  aria-label="Hex color"
                />
                {hexError && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "#ef4444",
                    }}
                  >
                    {hexError}
                  </span>
                )}
              </div>

              <p
                style={{
                  margin: "0.75rem 0 0",
                  fontSize: "0.75rem",
                  color: "var(--text-faint)",
                }}
              >
                Emails render this color as {`{{themePrimary}}`}. Existing
                email templates pick it up automatically; new templates can
                insert the value too.
              </p>
            </div>

            {/* =====================================
                PREVIEW
            ====================================== */}
            <div className="settings-panel">
              <h2>Preview</h2>
              <p>Live preview of the admin panel using the selected theme.</p>

              <div className="settings-preview">
                <div className="settings-preview-sidebar">
                  <span
                    className="settings-preview-dot"
                    style={{ background: themeColor }}
                  />
                  Quick Kart
                </div>
                <div className="settings-preview-nav">
                  <span>Dashboard</span>
                  <span>Users</span>
                  <span>Email Templates</span>
                  <span>Settings</span>
                </div>
                <div className="settings-preview-body">
                  <span
                    className="settings-preview-button"
                    style={{
                      background: themeColor,
                      borderColor: themeColor,
                    }}
                  >
                    Primary
                  </span>
                  <span className="settings-preview-outline">Outline</span>
                </div>
              </div>

              <div className="settings-email-preview">
                <div
                  className="settings-email-head"
                  style={{ background: themeColor }}
                >
                  <strong style={{ color: onPrimary }}>Quick Kart</strong>
                  <span style={{ color: onPrimary }}>Your credentials</span>
                </div>
                <div className="settings-email-body">
                  <p>
                    Hi John Doe, your account has been created. Sign in with
                    the credentials you received.
                  </p>
                  <a style={{ background: themeColor, color: onPrimary }}>
                    Log in to your account
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}