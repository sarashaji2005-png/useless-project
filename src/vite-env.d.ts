/// <reference types="vite/client" />

/**
 * Vite's ambient types, pulled in explicitly.
 *
 * `tsconfig.json` sets `"types": ["node"]`, which switches OFF automatic @types
 * discovery — so `import.meta.env` would otherwise be untyped even though Vite
 * defines it at build time. A triple-slash reference is unaffected by that
 * setting, so this restores the typing without editing the compiler config.
 */
