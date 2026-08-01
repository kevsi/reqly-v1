/**
 * Barrel file — re-exports all route-detection symbols.
 *
 * Consumers import from "@/lib/detect-shared" as before; the sub-file structure
 * is an internal implementation detail.
 */

// Types, constants, helpers
export type { HttpMethod, DetectedRoute } from "@/lib/detect-shared-types";
export {
  FRAMEWORK_FILE_EXTENSIONS,
  IGNORED_FOLDERS,
  isNonRouteFile,
  normalizePath,
  escapeRegExpStr,
  makeRoute,
  stripLanguageCommentsAndStrings,
  isRelevantFile,
} from "@/lib/detect-shared-types";

// Language / framework / port detection
export {
  detectLanguage,
  detectFramework,
  detectPort,
  defaultPortForFramework,
} from "@/lib/detect-shared-utils";

// Handler body analysis / auth detection
export {
  analyzeHandlerBody,
  detectAuthInArgs,
  detectBodyTypeInArgs,
  detectAuthByStatusSignal,
  inferAuthFromPathAndName,
  parseMethodList,
  addRoute,
} from "@/lib/detect-shared-handler";

// JS/TS framework detectors
export {
  detectExpress,
  detectFastify,
  detectKoa,
  detectHapi,
  detectKtor,
  detectNestJS,
  detectNextjsAppRouter,
  detectNextjsPagesRouter,
} from "@/lib/detect-shared-js-frameworks";

// Python framework detectors
export {
  detectFastAPI,
  detectFlask,
  detectDjango,
  detectTornado,
  detectSanic,
  detectStarlette,
  detectLitestar,
  detectAiohttp,
  detectFalcon,
} from "@/lib/detect-shared-python";

// Java / Kotlin framework detectors
export { detectSpring, detectMicronaut, detectQuarkus } from "@/lib/detect-shared-java";

// Multi-language framework detectors
export {
  detectLaravel,
  detectRails,
  detectPhoenix,
  detectServant,
  detectGo,
  detectRust,
  detectSwift,
  detectActix,
  detectAxum,
  detectRocket,
  detectAspNet,
} from "@/lib/detect-shared-multi";

// Orchestration
export {
  ensureTreeSitterLoaded,
  matchFramework,
  detectRoutes,
  scanFrontendApiCalls,
  correlateWithFrontendCall,
  detectNextJsRoutesFromTree,
  findEntryPoint,
  analyzeMiddlewareChain,
  detectDynamicRoutes,
} from "@/lib/detect-shared-orchestrator";
