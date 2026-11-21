// Tipos de cliente de Vite declarados aquí directamente: la referencia
// `/// <reference types="vite/client" />` no se estaba aplicando en el
// build de Render y `tsc` fallaba con TS2339 (import.meta.env) y TS2882
// (import de './index.css').
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css' {
  const src: string;
  export default src;
}
