import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores([
    "dist/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "electron/**",
  ]),
]);

export default eslintConfig;
