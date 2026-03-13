/** Compile-time constant set by esbuild. true when built with --dev flag, false otherwise.
 *  Code inside `if (DEV_MODE) { ... }` is dead-code-eliminated in production builds. */
declare const DEV_MODE: boolean;
