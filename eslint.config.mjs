import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["node_modules/**", "dist/**", "test-results/**", "main.js", "obsidian-plugin/**"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts", "lib/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
  },
]);
