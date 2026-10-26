// The worker build of PDF.js has no declarations; the app only hands it to PDF.js.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown
}
