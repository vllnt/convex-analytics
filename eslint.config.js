import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
          message: "Use @vllnt/logger instead of console.log. Import createConvexLogger from '@vllnt/logger/convex' for Convex functions, or createBackendLogger from '@vllnt/logger' for Node.js.",
        },
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='warn']",
          message: "Use @vllnt/logger instead of console.warn. Import createConvexLogger from '@vllnt/logger/convex' for Convex functions, or createBackendLogger from '@vllnt/logger' for Node.js.",
        },
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='error']",
          message: "Use @vllnt/logger instead of console.error. Import createConvexLogger from '@vllnt/logger/convex' for Convex functions, or createBackendLogger from '@vllnt/logger' for Node.js.",
        },
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='info']",
          message: "Use @vllnt/logger instead of console.info. Import createConvexLogger from '@vllnt/logger/convex' for Convex functions, or createBackendLogger from '@vllnt/logger' for Node.js.",
        },
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='debug']",
          message: "Use @vllnt/logger instead of console.debug. Import createConvexLogger from '@vllnt/logger/convex' for Convex functions, or createBackendLogger from '@vllnt/logger' for Node.js.",
        },
      ],
    },
  },
  {
    files: ["**/tests/**", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/_generated/**",
      ".turbo/**",
    ],
  },
];
