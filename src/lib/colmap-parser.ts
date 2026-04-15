import { ColmapData, ColmapPoint3D, ColmapImage, ColmapCamera } from "../types";

/**
 * Helper class for reading binary COLMAP files.
 */
class BufferReader {
  private view: DataView;
  private offset: number = 0;
  private littleEndian: boolean = true;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint32(): number {
    const val = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return val;
  }

  readInt32(): number {
    const val = this.view.getInt32(this.offset, this.littleEndian);
    this.offset += 4;
    return val;
  }

  readUint64(): number {
    const val = this.view.getBigUint64(this.offset, this.littleEndian);
    this.offset += 8;
    return Number(val);
  }

  readDouble(): number {
    const val = this.view.getFloat64(this.offset, this.littleEndian);
    this.offset += 8;
    return val;
  }

  readString(): string {
    let str = "";
    while (this.offset < this.view.byteLength) {
      const char = this.readUint8();
      if (char === 0) break;
      str += String.fromCharCode(char);
    }
    return str;
  }

  get isEOF(): boolean {
    return this.offset >= this.view.byteLength;
  }
}

/**
 * Parses cameras.bin or cameras.txt
 */
function parseCameras(data: string | ArrayBuffer, result: ColmapData) {
  try {
    if (data instanceof ArrayBuffer) {
      const reader = new BufferReader(data);
      const numCameras = reader.readUint64();
      for (let i = 0; i < numCameras; i++) {
        const id = reader.readUint32();
        const modelId = reader.readInt32();
        const width = reader.readUint64();
        const height = reader.readUint64();
        
        let numParams = 0;
        switch (modelId) {
          case 0: numParams = 3; break; // SIMPLE_PINHOLE
          case 1: numParams = 4; break; // PINHOLE
          case 2: numParams = 4; break; // SIMPLE_RADIAL
          case 3: numParams = 5; break; // RADIAL
          default: numParams = 8; break; // Fallback
        }

        const params = [];
        for (let j = 0; j < numParams; j++) params.push(reader.readDouble());
        result.cameras.set(id, { id, model: modelId.toString(), width, height, params });
      }
    } else {
      const lines = data.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 4) continue;
        const id = parseInt(parts[0]);
        if (isNaN(id)) continue;
        result.cameras.set(id, {
          id,
          model: parts[1],
          width: parseInt(parts[2]),
          height: parseInt(parts[3]),
          params: parts.slice(4).map(parseFloat),
        });
      }
    }
  } catch (e) {
    console.error("Parser: Error parsing cameras:", e);
  }
}

/**
 * Parses images.bin or images.txt
 */
function parseImages(data: string | ArrayBuffer, result: ColmapData) {
  try {
    if (data instanceof ArrayBuffer) {
      const reader = new BufferReader(data);
      const numImages = reader.readUint64();
      for (let i = 0; i < numImages; i++) {
        const id = reader.readUint32();
        const qw = reader.readDouble();
        const qx = reader.readDouble();
        const qy = reader.readDouble();
        const qz = reader.readDouble();
        const tx = reader.readDouble();
        const ty = reader.readDouble();
        const tz = reader.readDouble();
        const cameraId = reader.readUint32();
        const name = reader.readString();
        const numPoints2D = reader.readUint64();
        for (let j = 0; j < numPoints2D; j++) {
          reader.readDouble(); // x
          reader.readDouble(); // y
          reader.readUint64(); // point3D_id
        }
        result.images.set(id, { id, qw, qx, qy, qz, tx, ty, tz, cameraId, name, points2D: [] });
      }
    } else {
      const lines = data.split(/\r?\n/);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("#")) continue;
        
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;
        
        try {
          const id = parseInt(parts[0]);
          if (isNaN(id)) continue;
          const qw = parseFloat(parts[1]);
          const qx = parseFloat(parts[2]);
          const qy = parseFloat(parts[3]);
          const qz = parseFloat(parts[4]);
          const tx = parseFloat(parts[5]);
          const ty = parseFloat(parts[6]);
          const tz = parseFloat(parts[7]);
          const cameraId = parseInt(parts[8]);
          const name = parts[9];
          
          result.images.set(id, { id, qw, qx, qy, qz, tx, ty, tz, cameraId, name, points2D: [] });
          
          // Skip the points line
          i++;
          while (i < lines.length && (lines[i].trim().startsWith("#") || !lines[i].trim())) {
            i++;
          }
        } catch (e) {
          console.warn(`Parser: Failed to parse image line ${i}:`, line, e);
        }
      }
    }
  } catch (e) {
    console.error("Parser: Error parsing images:", e);
  }
}

/**
 * Parses points3D.bin or points3D.txt
 */
function parsePoints3D(data: string | ArrayBuffer, result: ColmapData) {
  try {
    if (data instanceof ArrayBuffer) {
      const reader = new BufferReader(data);
      const numPoints = reader.readUint64();
      for (let i = 0; i < numPoints; i++) {
        const id = reader.readUint64();
        const x = reader.readDouble();
        const y = reader.readDouble();
        const z = reader.readDouble();
        const r = reader.readUint8();
        const g = reader.readUint8();
        const b = reader.readUint8();
        const error = reader.readDouble();
        const trackLength = reader.readUint64();
        for (let j = 0; j < trackLength; j++) {
          reader.readUint32(); // image_id
          reader.readUint32(); // point2D_idx
        }
        result.points3D.set(id, { id, x, y, z, r, g, b, error });
      }
    } else {
      const lines = data.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 7) continue;
        
        try {
          const id = parseInt(parts[0]);
          if (isNaN(id)) continue;
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          
          if (isNaN(x) || isNaN(y) || isNaN(z)) continue;

          result.points3D.set(id, {
            id,
            x, y, z,
            r: parseInt(parts[4]) || 0,
            g: parseInt(parts[5]) || 0,
            b: parseInt(parts[6]) || 0,
            error: parseFloat(parts[7]) || 0,
          });
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error("Parser: Error parsing points3D:", e);
  }
}

/**
 * Main entry point for parsing COLMAP data.
 * Supports both text (.txt) and binary (.bin) formats.
 */
export async function parseColmapData(
  camerasData?: string | ArrayBuffer | null,
  imagesData?: string | ArrayBuffer | null,
  points3DData?: string | ArrayBuffer | null
): Promise<ColmapData> {
  const result: ColmapData = {
    cameras: new Map(),
    images: new Map(),
    points3D: new Map(),
  };

  if (camerasData) parseCameras(camerasData, result);
  if (imagesData) parseImages(imagesData, result);
  if (points3DData) parsePoints3D(points3DData, result);

  return result;
}
