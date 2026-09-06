import { relativePath } from "./order";

export interface Settings {
  language: "auto" | "zh" | "en";
  jsonPath: string;
  trigger: "row" | "handle";
  delay: number;
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
  if (typeof raw.jsonPath === "string" && raw.jsonPath.trim()) result.jsonPath = raw.jsonPath;
  if (typeof raw.delay === "number" && Number.isFinite(raw.delay))
    result.delay = Math.max(180, Math.min(800, raw.delay));
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
