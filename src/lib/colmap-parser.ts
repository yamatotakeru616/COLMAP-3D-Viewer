import { ColmapData } from "../types";

class BufferReader {
  view: DataView;
  offset: number = 0;
  littleEndian: boolean = true;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  readUint8() {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint32() {
    const val = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return val;
  }

  readInt32() {
    const val = this.view.getInt32(this.offset, this.littleEndian);
    this.offset += 4;
    return val;
  }

  readUint64() {
    const val = this.view.getBigUint64(this.offset, this.littleEndian);
    this.offset += 8;
    return Number(val);
  }

  readDouble() {
    const val = this.view.getFloat64(this.offset, this.littleEndian);
    this.offset += 8;
    return val;
  }

  readString() {
    let str = "";
    while (this.offset < this.view.byteLength) {
      const char = this.readUint8();
      if (char === 0) break;
      str += String.fromCharCode(char);
    }
    return str;
  }
}

export async function parseColmapData(
  camerasData?: string | ArrayBuffer | null,
  imagesData?: string | ArrayBuffer | null,
  points3DData?: string | ArrayBuffer | null
): Promise<ColmapData> {
  const data: ColmapData = {
    cameras: new Map(),
    images: new Map(),
    points3D: new Map(),
  };

  console.log("Starting COLMAP parsing...");

  const isBinary = (d: any) => d instanceof ArrayBuffer;

  // --- Parse Cameras ---
  if (camerasData) {
    if (isBinary(camerasData)) {
      console.log("Parsing cameras.bin");
      const reader = new BufferReader(camerasData as ArrayBuffer);
      const numCameras = reader.readUint64();
      for (let i = 0; i < numCameras; i++) {
        const id = reader.readUint32();
        const modelId = reader.readInt32();
        const width = reader.readUint64();
        const height = reader.readUint64();
        
        let numParams = 0;
        if (modelId === 0) numParams = 3; // SIMPLE_PINHOLE
        else if (modelId === 1) numParams = 4; // PINHOLE
        else if (modelId === 2) numParams = 4; // SIMPLE_RADIAL
        else if (modelId === 3) numParams = 5; // RADIAL
        else numParams = 8; // Fallback

        const params = [];
        for (let j = 0; j < numParams; j++) params.push(reader.readDouble());
        data.cameras.set(id, { id, model: modelId.toString(), width, height, params });
      }
    } else {
      const lines = (camerasData as string).split(/\r?\n/);
      console.log(`Parsing cameras.txt: ${lines.length} lines`);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || trimmed === "") continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 4) continue;
        const id = parseInt(parts[0]);
        data.cameras.set(id, {
          id,
          model: parts[1],
          width: parseInt(parts[2]),
          height: parseInt(parts[3]),
          params: parts.slice(4).map(parseFloat),
        });
      }
    }
    console.log(`Parsed ${data.cameras.size} cameras`);
  }

  // --- Parse Images ---
  if (imagesData) {
    if (isBinary(imagesData)) {
      console.log("Parsing images.bin");
      const reader = new BufferReader(imagesData as ArrayBuffer);
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
        data.images.set(id, { id, qw, qx, qy, qz, tx, ty, tz, cameraId, name, points2D: [] });
      }
    } else {
      const lines = (imagesData as string).split(/\r?\n/);
      console.log(`Parsing images.txt: ${lines.length} lines`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#") || line === "") continue;
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;
        try {
          const id = parseInt(parts[0]);
          const qw = parseFloat(parts[1]);
          const qx = parseFloat(parts[2]);
          const qy = parseFloat(parts[3]);
          const qz = parseFloat(parts[4]);
          const tx = parseFloat(parts[5]);
          const ty = parseFloat(parts[6]);
          const tz = parseFloat(parts[7]);
          const cameraId = parseInt(parts[8]);
          const name = parts[9];
          i++;
          while (i < lines.length && (lines[i].trim().startsWith("#") || lines[i].trim() === "")) i++;
          data.images.set(id, { id, qw, qx, qy, qz, tx, ty, tz, cameraId, name, points2D: [] });
        } catch (e) { console.warn(`Failed to parse image line ${i}:`, line, e); }
      }
    }
    console.log(`Parsed ${data.images.size} images`);
  }

  // --- Parse Points3D ---
  if (points3DData) {
    if (isBinary(points3DData)) {
      console.log("Parsing points3D.bin");
      const reader = new BufferReader(points3DData as ArrayBuffer);
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
        data.points3D.set(id, { id, x, y, z, r, g, b, error });
      }
    } else {
      const lines = (points3DData as string).split(/\r?\n/);
      console.log(`Parsing points3D.txt: ${lines.length} lines`);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || trimmed === "") continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 8) continue;
        try {
          const id = parseInt(parts[0]);
          data.points3D.set(id, {
            id,
            x: parseFloat(parts[1]),
            y: parseFloat(parts[2]),
            z: parseFloat(parts[3]),
            r: parseInt(parts[4]),
            g: parseInt(parts[5]),
            b: parseInt(parts[6]),
            error: parseFloat(parts[7]),
          });
        } catch (e) {}
      }
    }
    console.log(`Parsed ${data.points3D.size} points`);
  }

  return data;
}
