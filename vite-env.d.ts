// IVS_LANYARD_TYPES_V33_START
/// <reference types="vite/client" />

declare module "*.glb" {
  const source: string;
  export default source;
}

declare module "*.png" {
  const source: string;
  export default source;
}

declare module "meshline" {
  export const MeshLineGeometry: any;
  export const MeshLineMaterial: any;
}
// IVS_LANYARD_TYPES_V33_END
