import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-electron",
    "dist-vscode",
    "**/.vscode-test/**",
    "coverage",
    "playwright-report",
    "test-results",
    "node_modules",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        // typescript-eslint 8.67 会在模块级全局 Set 累积推断的 tsconfigRootDir 候选；
        // monorepo 多 tsconfig 下会出现多个候选并抛 "multiple candidate TSConfigRootDirs"。
        // 显式指定仓库根，避免歧义推断（错误信息亦建议如此）。
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 与 TS noUnusedParameters 保持一致：`_` 前缀表示「有意不使用」。
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);
