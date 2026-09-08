import { relativePath } from "./order";

export interface Settings {
  language: "auto" | "zh" | "en";
  trigger: "row" | "handle";
  delay: number;
  mouseDelay: number;
  excluded: string[];
}

/** Accept only known, well-typed fields from editable plugin data. */
export function readSettings(data: unknown): Partial<Settings> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const raw = data as Record<string, unknown>;
  const result: Partial<Settings> = {};
  if (raw.language === "auto" || raw.language === "zh" || raw.language === "en")
    result.language = raw.language;
  if (raw.trigger === "row" || raw.trigger === "handle") result.trigger = raw.trigger;
  if (typeof raw.delay === "number" && Number.isFinite(raw.delay))
    result.delay = Math.max(180, Math.min(800, raw.delay));
  if (typeof raw.mouseDelay === "number" && Number.isFinite(raw.mouseDelay))
    result.mouseDelay = Math.max(180, Math.min(800, raw.mouseDelay));
  if (Array.isArray(raw.excluded)) {
    const paths: unknown[] = raw.excluded;
    if (paths.every((path): path is string => typeof path === "string")) {
      try {
        result.excluded = [...new Set(paths.map(relativePath))];
      } catch {
        /* Retain the configured attachment default for malformed rules. */
      }
    }
  }
  return result;
}

export function loadSettings(data: unknown, excluded: string[]): Settings {
  const stored = readSettings(data);
  return {
    language: "auto",
    trigger: "row",
    delay: 500,
    mouseDelay: 200,
    excluded,
    ...stored,
  };
}
