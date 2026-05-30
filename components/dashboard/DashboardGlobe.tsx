"use client";

import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

// Example coordinates for the projects (will be fetched via API later)
const PROJECT_COORDS = [
  { lat: 15.3173, lng: 75.7139 }, // Karnataka
  { lat: 21.2514, lng: 81.6296 }, // Raipur/Rajpur
  { lat: 21.6289, lng: 85.5817 }, // Keonjhar
];

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = (radius * Math.sin(phi) * Math.sin(theta));
  const y = (radius * Math.cos(phi));

  return new THREE.Vector3(x, y, z);
}

function GlobeModel() {
  const globeRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  useFrame((state, delta) => {
    timeRef.current += delta;
    if (globeRef.current) {
      // Slow rotation
      globeRef.current.rotation.y = timeRef.current * 0.02;
    }
  });

  const [positions, setPositions] = React.useState<Float32Array | null>(null);

  React.useEffect(() => {
    fetch('/world-points.json')
      .then(res => res.json())
      .then(data => {
        setPositions(new Float32Array(data));
      })
      .catch(err => console.error("Error loading globe points:", err));
  }, []);

  // Convert project coordinates to 3D positions
  const projectPositions = useMemo(() => {
    const radius = 2.02; // slightly above the globe surface
    const positionsArray = new Float32Array(PROJECT_COORDS.length * 3);
    
    PROJECT_COORDS.forEach((coord, i) => {
      const pos = latLngToVector3(coord.lat, coord.lng, radius);
      positionsArray[i * 3] = pos.x;
      positionsArray[i * 3 + 1] = pos.y;
      positionsArray[i * 3 + 2] = pos.z;
    });
    
    return positionsArray;
  }, []);

  return (
    <group ref={globeRef}>
      {/* Core solid dark globe */}
      <Sphere args={[2, 64, 64]}>
        <meshStandardMaterial
          color="#0A0D14"
          emissive="#0A0D14"
          roughness={0.7}
          metalness={0.3}
          wireframe={false}
        />
      </Sphere>

      {/* Surrounding points/telemetry */}
      {positions && (
        <Points positions={positions}>
          <PointMaterial
            transparent
            color="#C97A4E"
            size={0.015}
            sizeAttenuation={true}
            depthWrite={false}
            opacity={0.3}
          />
        </Points>
      )}

      {/* Project markers */}
      <Points positions={projectPositions}>
        <PointMaterial
          transparent
          color="#FF8A4C"
          size={0.08}
          sizeAttenuation={true}
          depthWrite={false}
          opacity={1}
        />
      </Points>
    </group>
  );
}

export function DashboardGlobe() {
  return (
    <div className="w-full h-full absolute inset-0">
      {/* Ambient glowing background behind globe */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#C97A4E]/10 rounded-full blur-[120px] pointer-events-none" />
      
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} color="#C97A4E" />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#ffffff" />
        <GlobeModel />
      </Canvas>
    </div>
  );
}
