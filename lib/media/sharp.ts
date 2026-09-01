import "server-only";

import sharp from "sharp";

export const APPLICATION_SHARP_CACHE = Object.freeze({
  memoryMiB: 0,
  files: 0,
  items: 0,
});
export const APPLICATION_SHARP_CONCURRENCY = 1;

const applicationSharpSymbol = Symbol.for("lnx-studio.media.application-sharp.v1");

type ApplicationSharpGlobal = typeof globalThis & {
  [applicationSharpSymbol]?: Readonly<{
    singleton: typeof sharp;
    configurationApplications: 1;
  }>;
};

/**
 * Applies the application-owned libvips limits once per Node process, including
 * across Next server bundles and development reloads.
 */
export function configureApplicationSharp() {
  const processGlobal = globalThis as ApplicationSharpGlobal;
  processGlobal[applicationSharpSymbol] ??= (() => {
    sharp.cache(false);
    sharp.concurrency(APPLICATION_SHARP_CONCURRENCY);
    return Object.freeze({ singleton: sharp, configurationApplications: 1 as const });
  })();
  return processGlobal[applicationSharpSymbol].singleton;
}

export function getApplicationSharpState() {
  const singleton = configureApplicationSharp();
  const cache = singleton.cache();
  const processGlobal = globalThis as ApplicationSharpGlobal;
  return {
    configurationApplications: processGlobal[applicationSharpSymbol]!.configurationApplications,
    cache: {
      memoryMiB: cache.memory.max,
      files: cache.files.max,
      items: cache.items.max,
    },
    concurrency: singleton.concurrency(),
  } as const;
}

const applicationSharp = configureApplicationSharp();

export default applicationSharp;
