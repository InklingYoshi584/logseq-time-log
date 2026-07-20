import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        logseq: "readonly",
        console: "readonly",
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
      },
    },
  },
);
