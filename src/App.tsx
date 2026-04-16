import { useState, useCallback, ChangeEvent, useRef } from "react";
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
  const [flipY, setFlipY] = useState(true);
  const [activeTab, setActiveTab] = useState("view");
  const [error, setError] = useState<string | null>(null);
  
  const [pointsPage, setPointsPage] = useState(1);
  const [imagesPage, setImagesPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  const viewerRef = useRef<Viewer3DRef>(null);

  const downloadJson = () => {
    if (!data) return;
    
    // Convert Maps to objects for JSON serialization
    const exportData = {
      cameras: Object.fromEntries(data.cameras),
      images: Object.fromEntries(data.images),
      points3D: Object.fromEntries(data.points3D),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "colmap_data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadSampleData = () => {
    const sampleData: ColmapData = {
      cameras: new Map(),
      images: new Map(),
      points3D: new Map(),
    };

    // Create a simple cube of points
    let id = 1;
    for (let x = -2; x <= 2; x += 0.2) {
      for (let y = -2; y <= 2; y += 0.2) {
        for (let z = -2; z <= 2; z += 0.2) {
          sampleData.points3D.set(id, {
            id, x, y, z,
            r: Math.floor((x + 2) * 60),
            g: Math.floor((y + 2) * 60),
            b: Math.floor((z + 2) * 60),
            error: 0.1
          });
          id++;
        }
      }
    }

    // Add some mock cameras
    for (let i = 1; i <= 4; i++) {
      sampleData.images.set(i, {
        id: i,
        qw: 1, qx: 0, qy: 0, qz: 0,
        tx: Math.sin(i) * 5, ty: 0, tz: Math.cos(i) * 5,
        cameraId: 1,
        name: `sample_${i}.jpg`,
        points2D: []
      });
    }

    setData(sampleData);
    setError(null);
    setActiveTab("view");
  };

  const handleFileUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setError(null);
    let camerasData: string | ArrayBuffer | null = null;
    let imagesData: string | ArrayBuffer | null = null;
    let points3DData: string | ArrayBuffer | null = null;

    const readFile = (file: File, asText: boolean = true): Promise<string | ArrayBuffer> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as any);
        reader.onerror = (e) => reject(e);
        if (asText) reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
      });
    };

    try {
      const fileList = Array.from(files) as File[];
      const fileNames = fileList.map(f => f.name);
      console.log("Uploaded files:", fileNames);

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const name = file.name.toLowerCase();
        
        if (name.endsWith(".zip")) {
          console.log("Processing ZIP file:", file.name);
          const zip = await JSZip.loadAsync(file);
          const zipFiles = Object.keys(zip.files);
          console.log("Files in ZIP:", zipFiles);

          for (const zipFileName of zipFiles) {
            const lowerZipName = zipFileName.toLowerCase();
            const isTxt = lowerZipName.endsWith(".txt") || lowerZipName.endsWith(".text");
            const isBin = lowerZipName.endsWith(".bin");
            
            if (lowerZipName.includes("camera")) {
              if (isTxt) camerasData = await zip.files[zipFileName].async("string");
              else if (isBin) camerasData = await zip.files[zipFileName].async("arraybuffer");
            } else if (lowerZipName.includes("image")) {
              if (isTxt) imagesData = await zip.files[zipFileName].async("string");
              else if (isBin) imagesData = await zip.files[zipFileName].async("arraybuffer");
            } else if (lowerZipName.includes("points3d")) {
              if (isTxt) points3DData = await zip.files[zipFileName].async("string");
              else if (isBin) points3DData = await zip.files[zipFileName].async("arraybuffer");
            }
          }
          continue;
        }

        // More flexible matching: look for keywords in the filename
        const isTxt = name.endsWith(".txt") || name.endsWith(".text");
        const isBin = name.endsWith(".bin");

        if (name.includes("camera") && (isTxt || isBin)) {
          camerasData = await readFile(file, isTxt);
          console.log("Matched cameras file:", file.name);
        } else if (name.includes("image") && (isTxt || isBin)) {
          imagesData = await readFile(file, isTxt);
          console.log("Matched images file:", file.name);
        } else if (name.includes("points3d") && (isTxt || isBin)) {
          points3DData = await readFile(file, isTxt);
          console.log("Matched points3D file:", file.name);
        }
      }

      const missing = [];
      if (!camerasData) missing.push("cameras");
      if (!imagesData) missing.push("images");
      if (!points3DData) missing.push("points3D");

      // We need at least images OR points3D to show anything in 3D
      if (!imagesData && !points3DData) {
        throw new Error(`Insufficient data for 3D visualization.\n\nReceived: ${fileNames.join(", ")}\n\nTo see the reconstruction, you must upload at least 'images' (camera poses) or 'points3D' (point cloud).\n\nTip: You can select multiple files in the file dialog using Ctrl/Cmd + Click, or just upload the .zip file.`);
      }

      const parsed = await parseColmapData(camerasData, imagesData, points3DData);
      
      if (parsed.points3D.size === 0 && parsed.images.size === 0) {
        throw new Error("The uploaded files appear to be empty or in an unsupported format. Please ensure you exported as 'COLMAP (Text)' or 'COLMAP (Binary)'.");
      }

      if (missing.length > 0) {
        console.warn("Some files were missing but visualization is possible:", missing);
      }

      setData(parsed);
      setActiveTab("view");
    } catch (err) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred during upload.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
            {/* Upload Section */}
            <section>
              <Label className="col-header mb-3 block">Data Input</Label>
              <div className="relative group">
                <input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  accept=".txt,.bin,.zip"
                />
                <div className="border-2 border-dashed border-white/10 rounded-lg p-6 text-center group-hover:border-emerald-500/50 transition-colors bg-white/5">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-white/20 group-hover:text-emerald-500 transition-colors" />
                  <p className="text-sm font-medium">Drop 3 files or 1 ZIP</p>
                  <p className="text-[10px] text-white/40 mt-1 uppercase tracking-tighter">Select multiple files with Ctrl/Cmd + Click</p>
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
                        <span className="text-[10px] font-mono text-white/40">{pointSize.toFixed(3)}</span>
                      </div>
                      <Slider 
                        value={[pointSize]} 
                        min={0.001} 
                        max={0.2} 
                        step={0.001} 
                        onValueChange={(v) => setPointSize(v[0])}
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
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-white/40 hover:text-white"
              onClick={downloadJson}
              disabled={!data}
              title="Download Data as JSON"
            >
              <FileArchive className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white">
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 relative">
          {activeTab === "view" ? (
            data ? (
              <Viewer3D ref={viewerRef} data={data} pointSize={pointSize} showCameras={showCameras} flipY={flipY} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
                <Database className="w-16 h-16 mb-4 opacity-10" />
                <p className="text-sm font-mono uppercase tracking-[0.2em]">Waiting for data input...</p>
              </div>
            )
          ) : (
            <ScrollArea className="h-full">
              <div className="p-8 max-w-5xl mx-auto w-full pb-20">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="w-6 h-6 text-emerald-500" />
                    Data Explorer
                  </h2>
                  <Button variant="outline" size="sm" onClick={downloadJson} className="text-xs uppercase tracking-wider border-white/10">
                    Export to JSON
                  </Button>
                </div>
                
                {!data ? (
                  <p className="text-white/40 italic">No data loaded yet.</p>
                ) : (
                  <div className="space-y-12">
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="col-header">Camera Poses ({data.images.size})</h3>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            disabled={imagesPage === 1} 
                            onClick={() => setImagesPage(p => p - 1)}
                            className="h-7 text-[10px] uppercase"
                          >
                            Prev
                          </Button>
                          <span className="text-[10px] font-mono text-white/40">Page {imagesPage}</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            disabled={imagesPage * ITEMS_PER_PAGE >= data.images.size} 
                            onClick={() => setImagesPage(p => p + 1)}
                            className="h-7 text-[10px] uppercase"
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                      <div className="border border-white/10 rounded-lg overflow-hidden bg-white/5">
                        <div className="data-row bg-white/5 font-bold border-b border-white/10">
                          <div className="col-header">ID</div>
                          <div className="col-header">Image Name</div>
                          <div className="col-header">Translation</div>
                          <div className="col-header">Quaternion</div>
                        </div>
                        {Array.from(data.images.values())
                          .slice((imagesPage - 1) * ITEMS_PER_PAGE, imagesPage * ITEMS_PER_PAGE)
                          .map((img: ColmapImage) => (
                          <div key={img.id} className="data-row hover:bg-white/10 transition-colors">
                            <div className="data-value text-white/40">{img.id}</div>
                            <div className="font-medium truncate pr-2" title={img.name}>{img.name}</div>
                            <div className="data-value text-[10px]">
                              {img.tx.toFixed(2)}, {img.ty.toFixed(2)}, {img.tz.toFixed(2)}
                            </div>
                            <div className="data-value text-[10px] text-white/40">
                              {img.qw.toFixed(2)}, {img.qx.toFixed(2)}...
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="col-header">Point Cloud Samples ({data.points3D.size})</h3>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            disabled={pointsPage === 1} 
                            onClick={() => setPointsPage(p => p - 1)}
                            className="h-7 text-[10px] uppercase"
                          >
                            Prev
                          </Button>
                          <span className="text-[10px] font-mono text-white/40">Page {pointsPage}</span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            disabled={pointsPage * ITEMS_PER_PAGE >= data.points3D.size} 
                            onClick={() => setPointsPage(p => p + 1)}
                            className="h-7 text-[10px] uppercase"
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                      <div className="border border-white/10 rounded-lg overflow-hidden bg-white/5">
                        <div className="data-row bg-white/5 font-bold border-b border-white/10">
                          <div className="col-header">ID</div>
                          <div className="col-header">Position (X, Y, Z)</div>
                          <div className="col-header">Color (R, G, B)</div>
                          <div className="col-header">Error</div>
                        </div>
                        {Array.from(data.points3D.values())
                          .slice((pointsPage - 1) * ITEMS_PER_PAGE, pointsPage * ITEMS_PER_PAGE)
                          .map((p: ColmapPoint3D) => (
                          <div key={p.id} className="data-row hover:bg-white/10 transition-colors">
                            <div className="data-value text-white/40">{p.id}</div>
                            <div className="data-value text-[10px]">
                              {p.x.toFixed(3)}, {p.y.toFixed(3)}, {p.z.toFixed(3)}
                            </div>
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full border border-white/20" 
                                style={{ backgroundColor: `rgb(${p.r},${p.g},${p.b})` }} 
                              />
                              <span className="data-value text-[10px]">{p.r}, {p.g}, {p.b}</span>
                            </div>
                            <div className="data-value text-[10px] text-emerald-500/60">{p.error.toFixed(4)}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </main>
    </div>
  );
}
