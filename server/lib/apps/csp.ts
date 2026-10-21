import type { AppSandbox } from '@basyx/studio-sdk/protocol'

export interface AppPolicyOptions {
  /**
   * The installation has an origin of its own (ADR 0045), so its documents
   * keep that origin (`allow-same-origin`). With a shared apps origin they
   * stay opaque.
   */
  sameOrigin?: boolean
  /** Declared origins to leave out, e.g. those that cover Studio's own. */
  excludeOrigin?: (origin: string) => boolean
  /**
   * The origins of other installations' views the app may embed
   * (`studio.ui.embedView`, ADR 0051); their documents still refuse to be
   * framed without Studio's token.
   */
  viewOrigins?: string | null
}

/**
 * The Content Security Policy of every app file (ADR 0017). `base` is the
 * installation's own URL prefix, so scripts, styles and other resources can
 * only come from the app's package; nothing can be fetched from Studio or
 * elsewhere. `sandbox` keeps the document sandboxed, in an opaque origin
 * unless the installation has its own, even when it is opened outside
 * Studio's iframe. The manifest's `sandbox` may allow WebAssembly and
 * workers from `blob:` URLs (ADR 0038), and frames, requests, images and
 * media from declared origins (ADR 0045), and frames of other apps' views
 * (ADR 0051). Scripts, styles, fonts and
 * workers still load only the app's own files, and `worker-src` never
 * names them, so no service worker can be registered.
 */
export function appContentSecurityPolicy (base: string, frameAncestors: Iterable<string>, sandbox: AppSandbox = {}, options: AppPolicyOptions = {}): string {
  const declared = (origins: string[] | undefined) => (origins ?? []).filter(origin => !options.excludeOrigin?.(origin))
  const sources = (...values: string[]) => values.filter(Boolean).join(' ')
  const frames = [...declared(sandbox.frameOrigins), ...(options.viewOrigins ? [options.viewOrigins] : [])]
  return [
    `default-src 'none'`,
    `script-src ${sources(base, sandbox.webAssembly ? `'wasm-unsafe-eval'` : '')}`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${sources(base, 'data:', 'blob:', ...declared(sandbox.imageOrigins))}`,
    `font-src ${base}`,
    `media-src ${sources(base, 'blob:', ...declared(sandbox.mediaOrigins))}`,
    `connect-src ${sources(base, ...declared(sandbox.connectOrigins))}`,
    `frame-src ${frames.length > 0 ? frames.join(' ') : `'none'`}`,
    `worker-src ${sandbox.workers ? 'blob:' : `'none'`}`,
    `object-src 'none'`,
    `form-action 'none'`,
    `base-uri 'none'`,
    `frame-ancestors ${[...frameAncestors].join(' ')}`,
    `sandbox allow-scripts${options.sameOrigin ? ' allow-same-origin' : ''}`,
  ].join('; ')
}
