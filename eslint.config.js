import { convex } from "@vllnt/eslint-config/convex";
import tseslint from "typescript-eslint";

const LOGGER_MESSAGE =
  "Use @vllnt/logger instead. Import createConvexLogger from '@vllnt/logger/convex' for Convex functions, or createBackendLogger from '@vllnt/logger' for Node.js.";

function remapConvexPaths(config) {
  if (!config.files) return config;
  return {
    ...config,
    files: config.files.map((f) =>
      f
        .replace("**/convex/**", "**/src/component/**")
        .replace("**/convex/", "**/src/component/"),
    ),
    ...(config.ignores && {
      ignores: config.ignores.map((f) =>
        f
          .replace("**/convex/**", "**/src/component/**")
          .replace("**/convex/", "**/src/component/"),
      ),
    }),
  };
}

export default [
  // TypeScript parser for all TS files
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
  },

  ...convex.map(remapConvexPaths),

  {
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["log", "warn", "error", "info", "debug"].map((method) => ({
          selector: `CallExpression[callee.object.name='console'][callee.property.name='${method}']`,
          message: LOGGER_MESSAGE,
        })),
      ],
    },
  },

  {
    files: ["**/tests/**", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "convex-rules/no-bare-v-any": "off",
      "convex-rules/require-returns-validator": "off",
      "convex-rules/standard-filenames": "off",
      "convex-rules/namespace-separation": "off",
      "convex-rules/no-query-in-loop": "off",
      "convex-rules/no-filter-on-query": "off",
    },
  },

  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/_generated/**",
      ".turbo/**",
      "demo/**",
    ],
  },
];
