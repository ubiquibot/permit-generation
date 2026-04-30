import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/main.ts", "src/generate-permits-from-context.ts"],
  project: ["src/**/*.ts"],
  ignore: [],
  ignoreBinaries: ["publish"],
  ignoreExportsUsedInFile: true,
  ignoreDependencies: ["ts-node", "tslib", "@types/libsodium-wrappers"],
  jest: {
    config: ["jest.config.ts"],
    entry: ["tests/*.ts"],
  },
};

export default config;
