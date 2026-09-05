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
    "release/**",
    ".worktrees/**",
    "python/**",
    "extension/**",
  ]),
  {
    rules: {
      // IPC/SDK 边界大量使用 any,保留提示但不阻塞
      "@typescript-eslint/no-explicit-any": "warn",
      // 允许以 _ 开头的参数/变量作为"故意未使用"的占位符
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
