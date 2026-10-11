/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
// hls.js « light » : même API que la version complète, sans DRM ni sous-titres (types non fournis)
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
