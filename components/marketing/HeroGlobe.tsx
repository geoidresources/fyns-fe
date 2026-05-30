"use client";

import React, { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

function GlobeModel() {
  const globeRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);

  const timeRef = useRef(0);

  useFrame((state, delta) => {
    timeRef.current += delta;
    if (globeRef.current) {
      globeRef.current.rotation.y = timeRef.current * 0.05;
      globeRef.current.rotation.x = Math.sin(timeRef.current * 0.1) * 0.1;
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
            size={0.02}
            sizeAttenuation={true}
            depthWrite={false}
            opacity={0.6}
          />
        </Points>
      )}
    </group>
  );
}

export function HeroGlobe() {
  return (
    <div className="w-full h-full min-h-[400px] md:min-h-[600px] relative flex items-center justify-center">
      {/* Ambient glowing background behind globe */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-[#C97A4E]/20 rounded-full blur-[100px] pointer-events-none" />
      
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} color="#C97A4E" />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#ffffff" />
        <GlobeModel />
      </Canvas>
    </div>
  );
}
