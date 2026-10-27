// What the viewer shows and how, without Vue: decide on a view or an icon
// before any file is read, and which files hold 3D models, without loading
// three.js. The Vue components are `@basyx/file-viewer/vue`, the 3D viewer
// `@basyx/file-viewer/model/…`.

export * from './csv.ts'
export * from './kinds.ts'
export * from './model/index.ts'
export * from './text.ts'
