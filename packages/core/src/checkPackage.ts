import ts from "typescript";
import { fetchTarballHost } from "./fetchTarballHost.js";
import type {
  Host,
  Analysis,
  FS,
  ResolutionKind,
  EntrypointResolutionAnalysis,
  TraceCollector,
  Resolution,
} from "./types.js";

export async function checkPackage(
  packageName: string,
  packageVersion?: string,
  host: Host = fetchTarballHost
): Promise<Analysis> {
  const packageFS = await host.createPackageFS(packageName, packageVersion);
  const containsTypes = packageFS.listFiles().some(ts.hasTSFileExtension);
  if (!containsTypes) {
    return { containsTypes };
  }
  const entrypoints = checkEntrypoints(packageName, packageFS);
  return { packageName, containsTypes, entrypointResolutions: entrypoints };
}

function getSubpaths(exportsObject: any): string[] {
  if (!exportsObject || typeof exportsObject !== "object" || Array.isArray(exportsObject)) {
    return [];
  }
  // return Object.keys(packageJsonContent.exports);
  const keys = Object.keys(exportsObject);
  if (keys[0].startsWith(".")) {
    return keys;
  }
  return keys.flatMap((key) => getSubpaths(exportsObject[key]));
}

function checkEntrypoints(
  packageName: string,
  fs: FS
): Record<string, Record<ResolutionKind, EntrypointResolutionAnalysis>> {
  const packageJson = JSON.parse(fs.readFile(`/node_modules/${packageName}/package.json`));
  const subpaths = getSubpaths(packageJson.exports);
  const entrypoints = subpaths.length ? subpaths : ["."];
  const result: Record<string, Record<ResolutionKind, EntrypointResolutionAnalysis>> = {};
  for (const entrypoint of entrypoints) {
    result[entrypoint] = {
      node10: checkEntrypointTyped(packageName, fs, "node10", entrypoint),
      "node16-cjs": checkEntrypointTyped(packageName, fs, "node16-cjs", entrypoint),
      "node16-esm": checkEntrypointTyped(packageName, fs, "node16-esm", entrypoint),
      bundler: checkEntrypointTyped(packageName, fs, "bundler", entrypoint),
    };
  }
  return result;
}

function createModuleResolutionHost(fs: FS, trace: (message: string) => void): ts.ModuleResolutionHost {
  return {
    ...fs,
    trace,
  };
}

function createTraceCollector(): TraceCollector {
  const traces: string[] = [];
  return {
    trace: (message: string) => traces.push(message),
    read: () => {
      const result = traces.slice();
      traces.length = 0;
      return result;
    },
  };
}

function checkEntrypointTyped(
  packageName: string,
  fs: FS,
  resolutionKind: ResolutionKind,
  entrypoint: string
): EntrypointResolutionAnalysis {
  const moduleSpecifier = packageName + entrypoint.substring(1); // remove leading . before slash
  const fileName = resolutionKind === "node16-esm" ? "/index.mts" : "/index.ts";
  const moduleResolution =
    resolutionKind === "node10"
      ? // @ts-expect-error
        ts.ModuleResolutionKind.Node10
      : resolutionKind === "node16-cjs" || resolutionKind === "node16-esm"
      ? ts.ModuleResolutionKind.Node16
      : // @ts-expect-error
        ts.ModuleResolutionKind.Bundler;
  const resolutionMode = resolutionKind === "node16-esm" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS;
  const traceCollector = createTraceCollector();
  const resolutionHost = createModuleResolutionHost(fs, traceCollector.trace);

  const resolution = tryResolve();
  const implementationResolution =
    !resolution || ts.isDeclarationFileName(resolution.fileName) ? tryResolve(/*noDtsResolution*/ true) : undefined;

  return {
    name: entrypoint,
    resolution,
    implementationResolution,
    trace: traceCollector.read(),
  };

  function tryResolve(noDtsResolution?: boolean): Resolution | undefined {
    let moduleKind: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS | undefined;
    const resolution = ts.resolveModuleName(
      moduleSpecifier,
      fileName,
      {
        moduleResolution,
        traceResolution: !noDtsResolution,
        noDtsResolution,
      },
      resolutionHost,
      undefined,
      undefined,
      resolutionMode
    );
    if ((resolutionKind === "node16-cjs" || resolutionKind === "node16-esm") && resolution.resolvedModule) {
      if (
        resolution.resolvedModule.extension === ts.Extension.Mjs ||
        resolution.resolvedModule.extension === ts.Extension.Mts
      ) {
        moduleKind = ts.ModuleKind.ESNext;
      } else if (
        resolution.resolvedModule.extension === ts.Extension.Cjs ||
        resolution.resolvedModule.extension === ts.Extension.Cts
      ) {
        moduleKind = ts.ModuleKind.CommonJS;
      } else {
        const packageScope = ts.getPackageScopeForPath(
          resolution.resolvedModule.resolvedFileName,
          ts.getTemporaryModuleResolutionState(undefined, resolutionHost, { moduleResolution })
        );
        if (packageScope?.contents?.packageJsonContent.type === "module") {
          moduleKind = ts.ModuleKind.ESNext;
        } else {
          moduleKind = ts.ModuleKind.CommonJS;
        }
      }
    }
    return (
      resolution.resolvedModule && {
        fileName: resolution.resolvedModule.resolvedFileName,
        moduleKind,
        isTypeScript: ts.hasTSFileExtension(resolution.resolvedModule.resolvedFileName),
      }
    );
  }
}