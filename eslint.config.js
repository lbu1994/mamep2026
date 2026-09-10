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
    "dist-android",
    "**/.vscode-test/**",
    "coverage",
    "playwright-report",
    "test-results",
    "node_modules",
    // Android（Capacitor）工程：Gradle 构建产物、Capacitor 拷贝的 web 资源与 Cordova 插件 shim
    // 均为生成物（由 apps/android/android/.gitignore 忽略），ESLint 不读 .gitignore，故在此显式忽略。
    "apps/android/android/**/build/**",
    "apps/android/android/.gradle/**",
    "apps/android/android/app/src/main/assets/public/**",
    "apps/android/android/capacitor-cordova-android-plugins/**",
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
