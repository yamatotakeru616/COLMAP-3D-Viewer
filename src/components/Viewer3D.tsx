import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ColmapData, ColmapPoint3D } from '../types';

interface Viewer3DProps {
  data: ColmapData | null;
  pointSize?: number;
  showCameras?: boolean;
  flipY?: boolean;
}

export interface Viewer3DRef {
  resetView: () => void;
}

export const Viewer3D = forwardRef<Viewer3DRef, Viewer3DProps>(({ 
  data, 
  pointSize = 0.05,
  showCameras = true,
  flipY = true
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const cameraGroupRef = useRef<THREE.Group | null>(null);

  const resetView = () => {
    if (!pointsRef.current || !controlsRef.current || !cameraRef.current) return;
    const geometry = pointsRef.current.geometry;
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) {
      const center = geometry.boundingSphere.center;
      const radius = geometry.boundingSphere.radius;
      controlsRef.current.target.copy(center);
      cameraRef.current.position.set(center.x + radius, center.y + radius, center.z + radius);
      cameraRef.current.lookAt(center);
      controlsRef.current.update();
    }
  };

  useImperativeHandle(ref, () => ({
    resetView
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    // Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(5, 5, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // Grid and Axes
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(grid);
    const axes = new THREE.AxesHelper(1);
    scene.add(axes);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current || !data) return;

    // Clear previous points
    if (pointsRef.current) {
      sceneRef.current.remove(pointsRef.current);
      pointsRef.current.geometry.dispose();
      (pointsRef.current.material as THREE.Material).dispose();
    }

    // Add Points
    const points3D = Array.from(data.points3D.values()) as ColmapPoint3D[];
    if (points3D.length > 0) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(points3D.length * 3);
      const colors = new Float32Array(points3D.length * 3);

      points3D.forEach((p, i) => {
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = flipY ? -p.y : p.y;
        positions[i * 3 + 2] = flipY ? -p.z : p.z;
        colors[i * 3] = p.r / 255;
        colors[i * 3 + 1] = p.g / 255;
        colors[i * 3 + 2] = p.b / 255;
      });

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({ 
        size: pointSize, 
        vertexColors: true,
        sizeAttenuation: true 
      });
      
      const points = new THREE.Points(geometry, material);
      sceneRef.current.add(points);
      pointsRef.current = points;
    }
  }, [data, pointSize, flipY]);

  // Separate effect for centering camera only when data changes
  useEffect(() => {
    if (!data || !pointsRef.current || !controlsRef.current || !cameraRef.current) return;
    
    const geometry = pointsRef.current.geometry;
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) {
      const center = geometry.boundingSphere.center;
      const radius = geometry.boundingSphere.radius;
      controlsRef.current.target.copy(center);
      cameraRef.current.position.set(center.x + radius, center.y + radius, center.z + radius);
      cameraRef.current.lookAt(center);
      controlsRef.current.update();
    }
  }, [data]);

  useEffect(() => {
    if (!sceneRef.current || !data) return;

    // Clear previous cameras
    if (cameraGroupRef.current) {
      sceneRef.current.remove(cameraGroupRef.current);
      cameraGroupRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    // Add Cameras
    if (showCameras && data.images.size > 0) {
      const group = new THREE.Group();
      
      // Create a reusable camera frustum geometry
      const size = 0.1;
      const aspect = 1.5; // Default aspect ratio
      const depth = 0.15;
      
      const vertices = [
        0, 0, 0, // Center
        -size * aspect, -size, depth,
        size * aspect, -size, depth,
        size * aspect, size, depth,
        -size * aspect, size, depth,
      ];
      
      const indices = [
        0, 1, 0, 2, 0, 3, 0, 4, // Lines from center to corners
        1, 2, 2, 3, 3, 4, 4, 1  // Lines connecting corners
      ];
      
      const frustumGeom = new THREE.BufferGeometry();
      frustumGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      frustumGeom.setIndex(indices);
      
      const frustumMat = new THREE.LineBasicMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true });

      data.images.forEach(img => {
        const q = new THREE.Quaternion(img.qx, img.qy, img.qz, img.qw);
        const t = new THREE.Vector3(img.tx, img.ty, img.tz);
        
        const rMatrix = new THREE.Matrix4().makeRotationFromQuaternion(q);
        const rTranspose = rMatrix.clone().transpose();
        const worldPos = t.clone().applyMatrix4(rTranspose).multiplyScalar(-1);
        
        if (flipY) {
          worldPos.y *= -1;
          worldPos.z *= -1;
        }

        const camLine = new THREE.LineSegments(frustumGeom, frustumMat);
        camLine.position.copy(worldPos);
        
        if (flipY) {
          const rotX180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
          const newQ = q.clone().multiply(rotX180);
          camLine.quaternion.copy(newQ).invert();
        } else {
          camLine.quaternion.copy(q).invert();
        }
        
        group.add(camLine);
      });
      sceneRef.current.add(group);
      cameraGroupRef.current = group;
    }
  }, [data, showCameras, flipY]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full min-h-[500px] rounded-lg overflow-hidden border border-border bg-black"
      id="three-container"
    />
  );
});
