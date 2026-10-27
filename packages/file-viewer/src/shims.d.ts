// Single-file components for tsc; vue-tsc reads them itself.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent
  export default component
}
