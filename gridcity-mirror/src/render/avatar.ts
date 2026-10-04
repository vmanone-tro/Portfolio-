// VRM loading. (Phase 2 adds pose → bone application and character swapping here.)
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type { VRM };

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

export async function loadVrm(url: string): Promise<VRM> {
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${url} is not a VRM file`);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // no-op for VRM 1.0; turns VRM 0.x models to face the camera
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  return vrm;
}

/** Rough size check against the per-model budget in docs/CHARACTER_PACKS.md. */
export function modelStats(vrm: VRM): { triangles: number; textures: number; maxTextureSize: number } {
  let triangles = 0;
  const textures = new Set<THREE.Texture>();
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
    }
  });
  let maxTextureSize = 0;
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | undefined;
    maxTextureSize = Math.max(maxTextureSize, img?.width ?? 0, img?.height ?? 0);
  }
  return { triangles: Math.round(triangles), textures: textures.size, maxTextureSize };
}

/** A simple code-driven wave + breathing so the GPU does real skinning work (benchmark / idle). */
export function animateWave(vrm: VRM, t: number): void {
  const h = vrm.humanoid;
  const set = (name: Parameters<typeof h.getNormalizedBoneNode>[0], x: number, y: number, z: number) => {
    h.getNormalizedBoneNode(name)?.rotation.set(x, y, z);
  };
  set('spine', 0, Math.sin(t * 0.8) * 0.08, Math.sin(t * 1.1) * 0.03);
  set('chest', Math.sin(t * 1.6) * 0.02, 0, 0);
  set('head', Math.sin(t * 0.7) * 0.08, Math.sin(t * 0.5) * 0.25, 0);
  set('leftUpperArm', 0, 0, -1.1 + Math.sin(t * 1.3) * 0.05);
  set('leftLowerArm', 0, -0.3, 0);
  set('rightUpperArm', 0, 0, 1.0 + Math.sin(t * 2) * 0.25);
  set('rightLowerArm', 0, 0, 1.2 + Math.sin(t * 6) * 0.5);
  set('leftUpperLeg', 0, 0, 0.04);
  set('rightUpperLeg', 0, 0, -0.04);
  vrm.update(1 / 60);
}
