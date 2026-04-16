export interface ColmapCamera {
  id: number;
  model: string;
  width: number;
  height: number;
  params: number[];
}

export interface ColmapImage {
  id: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  tx: number;
  ty: number;
  tz: number;
  cameraId: number;
  name: string;
  points2D: { x: number; y: number; point3DId: number }[];
}

export interface ColmapPoint3D {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  error: number;
}

export interface ColmapData {
  cameras: Map<number, ColmapCamera>;
  images: Map<number, ColmapImage>;
  points3D: Map<number, ColmapPoint3D>;
}
