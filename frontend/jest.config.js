const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const customJestConfig = {
  // Testes daqui são só de lógica pura (nenhum deles renderiza componente
  // React nem toca no DOM) — "node" já basta e roda mais rápido que jsdom.
  testEnvironment: "node",
  testMatch: ["**/src/__tests__/**/*.test.ts"],
};

module.exports = createJestConfig(customJestConfig);
