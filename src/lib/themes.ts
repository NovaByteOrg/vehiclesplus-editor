/**
 * Editor themes. The UI chrome re-skins purely via the `[data-theme]` ramp overrides in globals.css
 * (Tailwind utilities resolve to `var(--color-…)`). The 3D viewport can't use CSS classes, so each
 * theme also carries explicit colours for the canvas background + grid, passed down to VehicleViewer.
 */

export interface EditorTheme {
  id: string;
  label: string;
  viewport: { bg: string; grid: string; grid2: string };
}

export const THEMES: EditorTheme[] = [
  { id: "graphite", label: "Graphite", viewport: { bg: "#131418", grid: "#2a2c31", grid2: "#393b42" } },
  { id: "amber", label: "Garage", viewport: { bg: "#14110d", grid: "#2c261c", grid2: "#3b3326" } },
  { id: "light", label: "Daylight", viewport: { bg: "#e9ebef", grid: "#cfd2d8", grid2: "#b8bcc4" } },
  { id: "cockpit", label: "Cockpit", viewport: { bg: "#0a0b0e", grid: "#1c2a27", grid2: "#244038" } },
];

export const DEFAULT_THEME = "graphite";

export function themeViewport(id: string) {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0]).viewport;
}
