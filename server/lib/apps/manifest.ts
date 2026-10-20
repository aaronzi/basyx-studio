// The manifest checks (ADR 0016) are shared with `studio-app pack` and
// `verify` of the app kit, so app authors get Studio's findings before they
// upload (ADR 0043).
export { checkCompatibility, checkManifestConsistency, manifestFileName, parseManifest } from '@basyx/studio-app-kit/manifest'
