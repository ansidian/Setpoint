export const GOOGLE_EVENT_COLORS = [
  { colorId: "1", enumName: "PALE_BLUE", label: "Lavender", docsLabel: "Pale Blue", hex: "#a4bdfc" },
  { colorId: "2", enumName: "PALE_GREEN", label: "Sage", docsLabel: "Pale Green", hex: "#7ae7bf" },
  { colorId: "3", enumName: "MAUVE", label: "Grape", docsLabel: "Mauve", hex: "#dbadff" },
  { colorId: "4", enumName: "PALE_RED", label: "Flamingo", docsLabel: "Pale Red", hex: "#ff887c" },
  { colorId: "5", enumName: "YELLOW", label: "Banana", docsLabel: "Yellow", hex: "#fbd75b" },
  { colorId: "6", enumName: "ORANGE", label: "Tangerine", docsLabel: "Orange", hex: "#ffb878" },
  { colorId: "7", enumName: "CYAN", label: "Peacock", docsLabel: "Cyan", hex: "#46d6db" },
  { colorId: "8", enumName: "GRAY", label: "Graphite", docsLabel: "Gray", hex: "#e1e1e1" },
  { colorId: "9", enumName: "BLUE", label: "Blueberry", docsLabel: "Blue", hex: "#5484ed" },
  { colorId: "10", enumName: "GREEN", label: "Basil", docsLabel: "Green", hex: "#51b749" },
  { colorId: "11", enumName: "RED", label: "Tomato", docsLabel: "Red", hex: "#dc2127" },
] as const;

export type GoogleEventColor = (typeof GOOGLE_EVENT_COLORS)[number];
export type GoogleEventColorId = GoogleEventColor["colorId"];

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export const GOOGLE_EVENT_COLOR_BY_ID = Object.fromEntries(
  GOOGLE_EVENT_COLORS.map((color) => [color.colorId, color]),
) as Record<GoogleEventColorId, GoogleEventColor>;

export const GOOGLE_EVENT_COLOR_ID_BY_HEX = Object.fromEntries(
  GOOGLE_EVENT_COLORS.map((color) => [color.hex.toLowerCase(), color.colorId]),
) as Record<string, GoogleEventColorId>;

export const GOOGLE_CALENDAR_SOURCE_COLOR_TO_EVENT_COLOR_ID = {
  "#2952a3": "9", // BLUE -> Blueberry
  "#8d6f47": "6", // BROWN -> Tangerine
  "#4e5d6c": "8", // CHARCOAL -> Graphite
  "#865a5a": "11", // CHESTNUT -> Tomato
  "#5a6986": "8", // GRAY -> Graphite
  "#0d7813": "10", // GREEN -> Basil
  "#5229a3": "3", // INDIGO -> Grape
  "#528800": "10", // LIME -> Basil
  "#88880e": "5", // MUSTARD -> Banana
  "#6e6e41": "10", // OLIVE -> Basil
  "#be6d00": "6", // ORANGE -> Tangerine
  "#b1365f": "4", // PINK -> Flamingo
  "#705770": "3", // PLUM -> Grape
  "#7a367a": "3", // PURPLE -> Grape
  "#a32929": "11", // RED -> Tomato
  "#b1440e": "6", // RED_ORANGE -> Tangerine
  "#29527a": "9", // SEA_BLUE -> Blueberry
  "#4a716c": "7", // SLATE -> Peacock
  "#28754e": "7", // TEAL -> Peacock
  "#1b887a": "7", // TURQOISE -> Peacock
  "#ab8b00": "5", // YELLOW -> Banana
} as const satisfies Record<string, GoogleEventColorId>;

function normalizeHex(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseHexColor(value: unknown): RgbColor | null {
  const hex = normalizeHex(value);
  const match = /^#?([0-9a-f]{6})$/.exec(hex);
  if (!match) return null;
  const clean = match[1]!;
  return {
    red: Number.parseInt(clean.slice(0, 2), 16),
    green: Number.parseInt(clean.slice(2, 4), 16),
    blue: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function colorDistance(a: RgbColor, b: RgbColor) {
  const redMean = (a.red + b.red) / 2;
  const red = a.red - b.red;
  const green = a.green - b.green;
  const blue = a.blue - b.blue;
  return (((512 + redMean) * red * red) / 256) + (4 * green * green) + (((767 - redMean) * blue * blue) / 256);
}

function nearestGoogleEventColorId(value: unknown): GoogleEventColorId | null {
  const target = parseHexColor(value);
  if (!target) return null;
  let best: GoogleEventColorId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of GOOGLE_EVENT_COLORS) {
    const parsed = parseHexColor(color.hex);
    if (!parsed) continue;
    const distance = colorDistance(target, parsed);
    if (distance < bestDistance) {
      best = color.colorId;
      bestDistance = distance;
    }
  }
  return best;
}

export function normalizeGoogleEventColorId(value: unknown): GoogleEventColorId | null {
  if (value == null || value === "") return null;
  const colorId = String(value);
  return Object.prototype.hasOwnProperty.call(GOOGLE_EVENT_COLOR_BY_ID, colorId)
    ? colorId as GoogleEventColorId
    : null;
}

export function googleEventColorForId(value: unknown): GoogleEventColor | null {
  const colorId = normalizeGoogleEventColorId(value);
  return colorId ? GOOGLE_EVENT_COLOR_BY_ID[colorId] : null;
}

export function googleEventColorIdForSourceHex(value: unknown): GoogleEventColorId | null {
  const hex = normalizeHex(value);
  return GOOGLE_EVENT_COLOR_ID_BY_HEX[hex]
    || (GOOGLE_CALENDAR_SOURCE_COLOR_TO_EVENT_COLOR_ID as Readonly<Record<string, GoogleEventColorId>>)[hex]
    || nearestGoogleEventColorId(hex);
}

export function googleEventColorForSourceHex(value: unknown): GoogleEventColor | null {
  const colorId = googleEventColorIdForSourceHex(value);
  return colorId ? GOOGLE_EVENT_COLOR_BY_ID[colorId] : null;
}
