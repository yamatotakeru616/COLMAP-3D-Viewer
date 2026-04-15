import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ColmapData, ColmapPoint3D, ColmapImage } from '../types';

interface Viewer3DProps {
  data: ColmapData | null;
  pointSize?: number;
  showCameras?: boolean;
  cameraInterval?: number;
  flipY?: boolean;
}

export interface Viewer3DRef {
  resetView: () => void;
}

/**
 * 3D Viewer component using Three.js to visualize COLMAP data.
 */
export const Viewer3D = forwardRef<Viewer3DRef, Viewer3DProps>(({ 
  data, 
  pointSize = 0.05,
  showCameras = true,
  cameraInterval = 1,
  flipY = true
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const cameraGroupRef = useRef<THREE.Group | null>(null);

  const [isInitialized, setIsInitialized] = React.useState(false);

  /**
   * Resets the camera view to fit all objects in the scene.
   */
  const resetView = () => {
    if (!controlsRef.current || !cameraRef.current) return;

    let center = new THREE.Vector3();
    let radius = 5;

    if (pointsRef.current) {
      const geometry = pointsRef.current.geometry;
      geometry.computeBoundingSphere();
      if (geometry.boundingSphere) {
        center.copy(geometry.boundingSphere.center);
        radius = geometry.boundingSphere.radius;
      }
    } else if (cameraGroupRef.current && cameraGroupRef.current.children.length > 0) {
      const box = new THREE.Box3().setFromObject(cameraGroupRef.current);
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      radius = size.length() || 5;
    } else {
      // Default view
      center.set(0, 0, 0);
      radius = 5;
    }

    controlsRef.current.target.copy(center);
    cameraRef.current.position.set(center.x + radius, center.y + radius, center.z + radius);
    cameraRef.current.lookAt(center);
    controlsRef.current.update();
  };

  useImperativeHandle(ref, () => ({
    resetView
  }));

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      2000
    );
    camera.position.set(10, 10, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    const updateSize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width === 0 || height === 0) return;
      
      const canvas = rendererRef.current.domElement;
      const pixelRatio = rendererRef.current.getPixelRatio();
      if (canvas.width === Math.floor(width * pixelRatio) && 
          canvas.height === Math.floor(height * pixelRatio)) {
        return;
      }

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;
    renderer.setSize(width, height);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 1);
    camera.add(pointLight);
    scene.add(camera);

    // Helpers
    const grid = new THREE.GridHelper(20, 20, 0x333333, 0x1a1a1a);
    scene.add(grid);
    const axes = new THREE.AxesHelper(2);
    scene.add(axes);

    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      return id;
    };
    const animationId = animate();

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        updateSize();
      });
    });
    resizeObserver.observe(containerRef.current);

    setIsInitialized(true);

    return () => {
      setIsInitialized(false);
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update Scene when data changes
  useEffect(() => {
    if (!isInitialized || !sceneRef.current || !data) {
      return;
    }

    // Cleanup previous objects
    const cleanup = (obj: THREE.Object3D | null) => {
      if (!obj) return;
      sceneRef.current?.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    };

    cleanup(pointsRef.current);
    cleanup(cameraGroupRef.current);

    // Render Points
    const points3D = Array.from(data.points3D.values()) as ColmapPoint3D[];
    if (points3D.length > 0) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(points3D.length * 3);
      const colors = new Float32Array(points3D.length * 3);

      points3D.forEach((p, i) => {
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = flipY ? -p.y : p.y;
        positions[i * 3 + 2] = flipY ? -p.z : p.z;
        colors[i * 3] = (p.r ?? 0) / 255;
        colors[i * 3 + 1] = (p.g ?? 0) / 255;
        colors[i * 3 + 2] = (p.b ?? 0) / 255;
      });

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({ 
        size: pointSize, 
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8
      });
      
      const points = new THREE.Points(geometry, material);
      sceneRef.current.add(points);
      pointsRef.current = points;

      // Auto-center view on first load
      geometry.computeBoundingSphere();
      if (geometry.boundingSphere && controlsRef.current && cameraRef.current) {
        const { center, radius } = geometry.boundingSphere;
        controlsRef.current.target.copy(center);
        cameraRef.current.position.set(center.x + radius, center.y + radius, center.z + radius);
        cameraRef.current.lookAt(center);
      }
    } else if (showCameras && data.images.size > 0) {
      // If no points, center on cameras
      const group = new THREE.Group();
      const images = Array.from(data.images.values()) as ColmapImage[];
      const positions: THREE.Vector3[] = [];
      
      images.forEach((img) => {
        const q = new THREE.Quaternion(img.qx, img.qy, img.qz, img.qw);
        const t = new THREE.Vector3(img.tx, img.ty, img.tz);
        const rMatrix = new THREE.Matrix4().makeRotationFromQuaternion(q);
        const worldPos = t.clone().applyMatrix4(rMatrix.clone().transpose()).multiplyScalar(-1);
        if (flipY) { worldPos.y *= -1; worldPos.z *= -1; }
        positions.push(worldPos);
      });

      if (positions.length > 0 && controlsRef.current && cameraRef.current) {
        const box = new THREE.Box3().setFromPoints(positions);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        const radius = size.length() || 5;
        
        controlsRef.current.target.copy(center);
        cameraRef.current.position.set(center.x + radius, center.y + radius, center.z + radius);
        cameraRef.current.lookAt(center);
      }
    }

    // Render Cameras
    if (showCameras && data.images.size > 0) {
      const group = new THREE.Group();
      const images = Array.from(data.images.values()) as ColmapImage[];
      
      images.forEach((img, index) => {
        if (index % cameraInterval !== 0) return;

        // COLMAP world-to-camera: X_c = R * X_w + T
        const q = new THREE.Quaternion(img.qx, img.qy, img.qz, img.qw);
        const t = new THREE.Vector3(img.tx, img.ty, img.tz);
        
        // Camera position in world: C = -R^T * T
        const rMatrix = new THREE.Matrix4().makeRotationFromQuaternion(q);
        const worldPos = t.clone().applyMatrix4(rMatrix.clone().transpose()).multiplyScalar(-1);
        
        if (flipY) {
          worldPos.y *= -1;
          worldPos.z *= -1;
        }

        const camGeom = new THREE.ConeGeometry(0.1, 0.2, 4);
        const camMat = new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true });
        const camMesh = new THREE.Mesh(camGeom, camMat);
        
        camMesh.position.copy(worldPos);
        
        if (flipY) {
          const rotX180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
          const newQ = q.clone().multiply(rotX180);
          camMesh.quaternion.copy(newQ).invert();
        } else {
          camMesh.quaternion.copy(q).invert();
        }
        camMesh.rotateX(Math.PI / 2);
        
        group.add(camMesh);
      });
      sceneRef.current.add(group);
      cameraGroupRef.current = group;
    }
  }, [isInitialized, data, pointSize, showCameras, cameraInterval, flipY]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full min-h-[500px] rounded-lg overflow-hidden border border-white/10 bg-black"
      id="three-container"
    />
  );
});
