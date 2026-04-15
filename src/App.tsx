import { useState, useCallback, ChangeEvent, useRef, useEffect, DragEvent } from "react";
import JSZip from "jszip";
import { 
  Upload, 
  Box, 
  Camera, 
  Database, 
  Settings2, 
  Info,
  FileText,
  ChevronRight,
  Maximize2,
  RefreshCw,
  Sparkles,
  FileArchive
} from "lucide-react";
import { Viewer3D, Viewer3DRef } from "./components/Viewer3D";
import { parseColmapData } from "./lib/colmap-parser";
import { ColmapData, ColmapImage, ColmapPoint3D } from "./types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

export default function App() {
  const [data, setData] = useState<ColmapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pointSize, setPointSize] = useState(0.02);
  const [showCameras, setShowCameras] = useState(true);
  const [cameraInterval, setCameraInterval] = useState(1);
  const [flipY, setFlipY] = useState(true);
  const [activeTab, setActiveTab] = useState("view");
  const [error, setError] = useState<string | null>(null);
  const [webglSupported, setWebglSupported] = useState(true);
  const viewerRef = useRef<Viewer3DRef>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const support = !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
      setWebglSupported(support);
    } catch (e) {
      setWebglSupported(false);
    }
  }, []);

  const loadSampleData = () => {
    try {
      setLoading(false);
      const sampleData: ColmapData = {
        cameras: new Map(),
        images: new Map(),
        points3D: new Map(),
      };

      // Create a more interesting shape: A sphere and a floor
      let id = 1;
      
      // Sphere
      const sphereRadius = 2;
      for (let phi = 0; phi < Math.PI; phi += 0.2) {
        for (let theta = 0; theta < 2 * Math.PI; theta += 0.2) {
          const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
          const y = sphereRadius * Math.sin(phi) * Math.sin(theta) + 2;
          const z = sphereRadius * Math.cos(phi);
          
          sampleData.points3D.set(id, {
            id, x, y, z,
            r: Math.floor(100 + Math.random() * 155),
            g: Math.floor(50 + Math.random() * 100),
            b: Math.floor(200 + Math.random() * 55),
            error: 0.05
          });
          id++;
        }
      }

      // Floor
      for (let x = -5; x <= 5; x += 0.5) {
        for (let z = -5; z <= 5; z += 0.5) {
          sampleData.points3D.set(id, {
            id, x, y: 0, z,
            r: 100, g: 100, b: 100,
            error: 0.1
          });
          id++;
        }
      }

      // Add mock cameras in a circle
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const camX = Math.sin(angle) * 8;
        const camZ = Math.cos(angle) * 8;
        const camY = 3;

        // Simple look-at-center rotation (approximate)
        sampleData.images.set(i + 1, {
          id: i + 1,
          qw: 1, qx: 0, qy: 0, qz: 0, // Simplified
          tx: camX, ty: camY, tz: camZ,
          cameraId: 1,
          name: `sample_${i + 1}.jpg`,
          points2D: []
        });
      }

      setData(sampleData);
      setError(null);
      setActiveTab("view");
      
      setTimeout(() => {
        viewerRef.current?.resetView();
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sample data.");
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    setLoading(true);
    setError(null);
    let camerasData: string | ArrayBuffer | null = null;
    let imagesData: string | ArrayBuffer | null = null;
    let points3DData: string | ArrayBuffer | null = null;

    const readFile = (file: File | JSZip.JSZipObject, asText: boolean): Promise<string | ArrayBuffer> => {
      if (file instanceof File) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as any);
          reader.onerror = (e) => reject(e);
          if (asText) reader.readAsText(file);
          else reader.readAsArrayBuffer(file);
        });
      } else {
        return asText ? file.async("string") : file.async("arraybuffer");
      }
    };

    try {
      const fileList = Array.from(files);
      const fileNames = fileList.map(f => f.name);
      
      for (const file of fileList) {
        const name = file.name.toLowerCase();
        
        if (name.endsWith(".zip")) {
          const zip = await JSZip.loadAsync(file);
          for (const [zipPath, zipFile] of Object.entries(zip.files)) {
            if (zipFile.dir) continue;
            const lowerPath = zipPath.toLowerCase();
            const fileName = lowerPath.split('/').pop() || "";
            const isTxt = fileName.endsWith(".txt") || fileName.endsWith(".text");
            const isBin = fileName.endsWith(".bin");
            if (!isTxt && !isBin) continue;

            if (fileName.includes("camera")) camerasData = await readFile(zipFile, isTxt);
            else if (fileName.includes("image")) imagesData = await readFile(zipFile, isTxt);
            else if (fileName.includes("points3d") || fileName.includes("points")) points3DData = await readFile(zipFile, isTxt);
          }
          continue;
        }

        const isTxt = name.endsWith(".txt") || name.endsWith(".text");
        const isBin = name.endsWith(".bin");
        if (!isTxt && !isBin) continue;

        // For individual files, we check the name directly
        if (name.includes("camera")) {
          camerasData = await readFile(file, isTxt);
        } else if (name.includes("image")) {
          imagesData = await readFile(file, isTxt);
        } else if (name.includes("points3d") || name.includes("points")) {
          points3DData = await readFile(file, isTxt);
        }
      }

      // We need at least images OR points3D to show anything in 3D
      if (!imagesData && !points3DData) {
        const foundFiles = fileList.map(f => f.name).join(", ");
        throw new Error(`Insufficient data for 3D visualization.\n\nFound files: ${foundFiles || "None"}\n\nTo see the reconstruction, you must upload at least 'images' (camera poses) or 'points3D' (point cloud) files.\n\nNote: RealityScan exports these as .txt or .bin files. Please select all of them or upload the exported .zip file.`);
      }

      const parsed = await parseColmapData(camerasData, imagesData, points3DData);
      
      if (parsed.points3D.size === 0 && parsed.images.size === 0) {
        throw new Error("The uploaded files appear to be empty or in an unsupported format.");
      }

      setData(parsed);
      setActiveTab("view");
      setTimeout(() => {
        viewerRef.current?.resetView();
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred during upload.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleFileUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      processFiles(event.target.files);
    }
  }, [processFiles]);

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-[#e5e5e5] overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 border-r border-white/10 flex flex-col bg-[#0f0f0f]">
        <div className="p-6 border-bottom border-white/10">
          <div className="flex items-center gap-2 mb-1">
            <Box className="w-6 h-6 text-emerald-500" />
            <h1 className="text-lg font-bold tracking-tight">COLMAP VIEWER</h1>
          </div>
          <p className="text-xs text-white/40 font-mono">v1.0.0 // REALITY SCAN</p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <section>
              <Label className="col-header mb-3 block">Data Input</Label>
              <div className="space-y-4">
                <div 
                  className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-emerald-500/50 transition-colors cursor-pointer group relative bg-white/5"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-500 group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Drop COLMAP files here</p>
                      <p className="text-xs text-white/40 mt-1">.txt, .bin, or .zip</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    className="w-full border-white/10 hover:bg-white/5 text-white/70 h-9 text-[10px] uppercase tracking-wider"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Select Files
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 h-9 text-[10px] uppercase tracking-wider"
                    onClick={loadSampleData}
                  >
                    Load Sample
                  </Button>
                </div>
              </div>
            </section>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs font-medium flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap">{error}</span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                  onClick={() => setError(null)}
                >
                  Clear Error
                </Button>
              </div>
            )}

            {data && (
              <>
                {/* Stats Section */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="col-header">Reconstruction Stats</Label>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-white/40 hover:text-white"
                      onClick={() => viewerRef.current?.resetView()}
                      title="Reset View"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/5 p-3 rounded border border-white/5">
                      <p className="text-[10px] text-white/40 uppercase font-bold">Points</p>
                      <p className="text-xl font-mono text-emerald-400">{data.points3D.size.toLocaleString()}</p>
                    </div>
                    <div className="bg-white/5 p-3 rounded border border-white/5">
                      <p className="text-[10px] text-white/40 uppercase font-bold">Cameras</p>
                      <p className="text-xl font-mono text-blue-400">{data.images.size.toLocaleString()}</p>
                    </div>
                  </div>
                </section>

                {/* Controls Section */}
                <section className="space-y-4">
                  <Label className="col-header mb-3 block">Display Settings</Label>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium">Point Size</span>
                        <span className="text-[10px] font-mono text-white/40">{(pointSize || 0).toFixed(3)}</span>
                      </div>
                      <Slider 
                        value={[pointSize]} 
                        min={0.001} 
                        max={0.2} 
                        step={0.001} 
                        onValueChange={(v) => {
                          const val = Array.isArray(v) ? v[0] : v;
                          setPointSize(val ?? 0.02);
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded border border-white/5">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-medium">Show Camera Frustums</span>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={showCameras} 
                        onChange={(e) => setShowCameras(e.target.checked)}
                        className="w-4 h-4 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500"
                      />
                    </div>
                    {showCameras && (
                      <div className="space-y-2 px-3 pb-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-medium text-white/60">Camera Interval</span>
                          <span className="text-[10px] font-mono text-white/40">Every {cameraInterval}th</span>
                        </div>
                        <Slider 
                          value={[cameraInterval]} 
                          min={1} 
                          max={20} 
                          step={1} 
                          onValueChange={(v) => {
                            const val = Array.isArray(v) ? v[0] : v;
                            setCameraInterval(val ?? 1);
                          }}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded border border-white/5">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-medium">Flip Y-Axis (COLMAP Fix)</span>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={flipY} 
                        onChange={(e) => setFlipY(e.target.checked)}
                        className="w-4 h-4 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </section>
              </>
            )}

            {!data && (
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="p-4">
                  <div className="flex items-center gap-2 text-emerald-500 mb-1">
                    <Info className="w-4 h-4" />
                    <CardTitle className="text-sm">Getting Started</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-white/50 space-y-2">
                    <p>RealityScanからエクスポートする際は、 <strong>「COLMAP (Text)」</strong> または <strong>「COLMAP (Binary)」</strong> 形式を選択してください。</p>
                    <p>以下の3つのファイルを同時にアップロードするか、それらを含む <strong>.zip</strong> ファイルをアップロードしてください：</p>
                    <ul className="list-disc list-inside opacity-80">
                      <li>cameras.txt / .bin</li>
                      <li>images.txt / .bin</li>
                      <li>points3D.txt / .bin</li>
                    </ul>
                    <p className="text-[10px] text-emerald-500/70">※.bin（バイナリ形式）と.txt（テキスト形式）の両方に対応しました。</p>
                    <div className="pt-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-[10px] uppercase tracking-wider border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                        onClick={loadSampleData}
                      >
                        <Sparkles className="w-3 h-3 mr-2" />
                        サンプルデータを読み込む
                      </Button>
                    </div>
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-white/10 bg-black/20">
          <div className="flex items-center justify-between text-[10px] font-mono text-white/30 uppercase tracking-widest">
            <span>Status: {loading ? "Processing..." : data ? "Ready" : "Idle"}</span>
            <div className={`w-2 h-2 rounded-full ${loading ? "bg-yellow-500 animate-pulse" : data ? "bg-emerald-500" : "bg-white/10"}`} />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList className="bg-white/5 border border-white/10 h-8 p-0.5">
                <TabsTrigger value="view" className="text-[10px] uppercase tracking-wider h-7 px-4 data-[state=active]:bg-white/10">3D View</TabsTrigger>
                <TabsTrigger value="data" className="text-[10px] uppercase tracking-wider h-7 px-4 data-[state=active]:bg-white/10">Data Explorer</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-4">
            {data && (
              <Badge variant="outline" className="font-mono text-[10px] border-emerald-500/30 text-emerald-500 bg-emerald-500/5">
                {data.points3D.size} POINTS LOADED
              </Badge>
            )}
            {data && (
              <>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 gap-2 text-white/60 hover:text-white hover:bg-white/10"
                  onClick={() => viewerRef.current?.resetView()}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Reset View</span>
                </Button>
                <div className="h-4 w-px bg-white/10 mx-1" />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 gap-2 text-red-400/60 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => {
                    setData(null);
                    setError(null);
                  }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Clear</span>
                </Button>
                <div className="h-4 w-px bg-white/10 mx-1" />
              </>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white">
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
              <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
              <p className="text-sm font-mono uppercase tracking-widest text-emerald-500">Processing Reconstruction...</p>
            </div>
          )}
          {!webglSupported && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black p-8 text-center">
              <Info className="w-12 h-12 text-red-500 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">WebGL Not Supported</h3>
              <p className="text-sm text-white/60 max-w-md">
                Your browser or device does not seem to support WebGL, which is required for 3D visualization. 
                Please try using a modern browser like Chrome, Edge, or Firefox.
              </p>
            </div>
          )}
          {activeTab === "view" ? (
            data ? (
              <Viewer3D 
                ref={viewerRef} 
                data={data} 
                pointSize={pointSize} 
                showCameras={showCameras} 
                cameraInterval={cameraInterval}
                flipY={flipY} 
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                <Database className="w-16 h-16 mb-4 opacity-10" />
                <p className="text-sm font-mono uppercase tracking-[0.2em] mb-6">Waiting for data input...</p>
                <div className="flex flex-col gap-3">
                  <Button 
                    variant="outline" 
                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={loadSampleData}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Load Sample Scene
                  </Button>
                  
                  <Button 
                    variant="ghost"
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white/60 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Select Files Manually
                  </Button>
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    multiple 
                    className="hidden" 
                    onChange={(e) => e.target.files && processFiles(e.target.files)} 
                  />
                </div>
                
                {error && (
                  <div className="mt-8 p-4 rounded-lg bg-red-500/10 border border-red-500/20 max-w-md">
                    <p className="text-xs font-mono text-red-400 whitespace-pre-wrap">{error}</p>
                  </div>
                )}

                <div className="mt-12 p-4 rounded bg-white/5 border border-white/10 max-w-sm text-center">
                  <p className="text-[10px] text-white/40 uppercase leading-relaxed">
                    If you cannot select files, try opening the app in a <strong>new tab</strong> using the button in the top right of the preview.
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="p-8 max-w-4xl mx-auto w-full">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <FileText className="w-6 h-6 text-emerald-500" />
                Data Explorer
              </h2>

              <Card className="bg-white/5 border-white/10 mb-8">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Info className="w-4 h-4 text-emerald-500" />
                    How to use this viewer
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-white/60 leading-relaxed">
                  <p>
                    This viewer supports 3D reconstructions exported from <strong>COLMAP</strong> or <strong>RealityScan</strong>.
                  </p>
                  <div className="flex flex-wrap gap-8">
                    <div className="space-y-2">
                      <p className="font-medium text-white/80">Required Files:</p>
                      <ul className="list-disc list-inside space-y-1 font-mono text-xs">
                        <li>cameras.txt / .bin</li>
                        <li>images.txt / .bin</li>
                        <li>points3D.txt / .bin</li>
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <p className="font-medium text-white/80">Upload Method:</p>
                      <p className="text-xs">Select all files at once or upload a <strong>.zip</strong> archive.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {!data ? (
                <p className="text-white/40 italic">No data loaded yet.</p>
              ) : (
                <div className="space-y-8">
                  <section>
                    <h3 className="col-header mb-4">Recent Camera Poses</h3>
                    <div className="border border-white/10 rounded-lg overflow-hidden">
                      <div className="data-row bg-white/5 font-bold">
                        <div className="col-header">ID</div>
                        <div className="col-header">Image Name</div>
                        <div className="col-header">Translation</div>
                        <div className="col-header">Quaternion</div>
                      </div>
                      {Array.from(data.images.values()).slice(0, 10).map((img: ColmapImage) => {
                        if (!img) return null;
                        return (
                          <div key={img.id} className="data-row">
                            <div className="data-value text-white/40">{img.id}</div>
                            <div className="font-medium">{img.name}</div>
                            <div className="data-value text-xs">
                              {(img.tx ?? 0).toFixed(2)}, {(img.ty ?? 0).toFixed(2)}, {(img.tz ?? 0).toFixed(2)}
                            </div>
                            <div className="data-value text-xs text-white/40">
                              {(img.qw ?? 0).toFixed(2)}, {(img.qx ?? 0).toFixed(2)}...
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <h3 className="col-header mb-4">Point Cloud Samples</h3>
                    <div className="border border-white/10 rounded-lg overflow-hidden">
                      <div className="data-row bg-white/5 font-bold">
                        <div className="col-header">ID</div>
                        <div className="col-header">Position (X, Y, Z)</div>
                        <div className="col-header">Color (R, G, B)</div>
                        <div className="col-header">Error</div>
                      </div>
                      {Array.from(data.points3D.values()).slice(0, 10).map((p: ColmapPoint3D) => {
                        if (!p) return null;
                        return (
                          <div key={p.id} className="data-row">
                            <div className="data-value text-white/40">{p.id}</div>
                            <div className="data-value text-xs">
                              {(p.x ?? 0).toFixed(3)}, {(p.y ?? 0).toFixed(3)}, {(p.z ?? 0).toFixed(3)}
                            </div>
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full border border-white/20" 
                                style={{ backgroundColor: `rgb(${p.r ?? 0},${p.g ?? 0},${p.b ?? 0})` }} 
                              />
                              <span className="data-value text-xs">{p.r ?? 0}, {p.g ?? 0}, {p.b ?? 0}</span>
                            </div>
                            <div className="data-value text-xs text-emerald-500/60">{(p.error ?? 0).toFixed(4)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
