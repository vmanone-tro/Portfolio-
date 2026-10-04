// three.js stage: camera framed for a standing person, soft 3-point lighting, Grid City floor + backdrop.
import * as THREE from 'three';

/** Height range of the world we keep in frame (metres): floor to just above a tall guest's head. */
const FRAME_BOTTOM = -0.08;
const FRAME_TOP = 2.02;

export class Stage3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 9 / 16, 0.1, 60);
  /** Add characters here. */
  readonly stageRoot = new THREE.Group();
  private gridMat: THREE.ShaderMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.background = makeBackdrop();
    this.scene.fog = new THREE.Fog(0x070814, 9, 28);

    // Lighting: cool sky + warm key from the front, cyan and magenta rims from behind (Grid City colours).
    this.scene.add(new THREE.HemisphereLight(0xa9c8ff, 0x1b1030, 1.3));
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(-1.5, 3, 4);
    const fill = new THREE.DirectionalLight(0x9ab8ff, 0.7);
    fill.position.set(2, 1.5, 3);
    const rimCyan = new THREE.DirectionalLight(0x00e5ff, 2.6);
    rimCyan.position.set(2.5, 2.5, -3);
    const rimPink = new THREE.DirectionalLight(0xff3dcf, 2.0);
    rimPink.position.set(-2.5, 2, -3);
    this.scene.add(key, fill, rimCyan, rimPink);

    this.gridMat = makeGridMaterial();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.gridMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.scene.add(this.stageRoot);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Fit the person's full height; in landscape also keep a minimum width for 2 people.
    const halfH = (FRAME_TOP - FRAME_BOTTOM) / 2;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    let dist = halfH / Math.tan(fovRad / 2);
    const minHalfW = 0.72;
    dist = Math.max(dist, minHalfW / (Math.tan(fovRad / 2) * aspect));
    const cy = (FRAME_TOP + FRAME_BOTTOM) / 2;
    this.camera.position.set(0, cy + 0.05, dist);
    this.camera.lookAt(0, cy, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Half the visible width at the character's depth — how far a guest can move sideways. */
  visibleHalfWidth(): number {
    const fovRad = (this.camera.fov * Math.PI) / 180;
    return Math.tan(fovRad / 2) * this.camera.position.z * this.camera.aspect;
  }

  render(t: number): void {
    this.gridMat.uniforms.uTime.value = t;
    this.renderer.render(this.scene, this.camera);
  }
}

function makeBackdrop(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#03040b');
  grad.addColorStop(0.55, '#0b0f2a');
  grad.addColorStop(0.78, '#2a0f45');
  grad.addColorStop(1, '#070814');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vPos;
      uniform float uTime;
      float line(float v, float w) {
        float d = abs(fract(v - 0.5) - 0.5) / fwidth(v);
        return 1.0 - min(d / w, 1.0);
      }
      void main() {
        vec2 p = vPos * 1.0;
        p.y += uTime * 0.25; // grid slowly flows towards the viewer
        float g = max(line(p.x, 1.2), line(p.y, 1.2));
        float r = length(vPos);
        float fade = smoothstep(14.0, 2.0, r);
        vec3 col = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.24, 0.81), smoothstep(2.0, 10.0, r));
        gl_FragColor = vec4(col * g, g * fade * 0.55);
      }`,
  });
}

/** Soft glow on the floor where the character stands (also reads as a contact shadow edge). */
export function makeSpotlightDisc(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.35, 'rgba(0,30,40,0.6)');
  grad.addColorStop(0.7, 'rgba(0,229,255,0.18)');
  grad.addColorStop(1, 'rgba(0,229,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.002;
  return disc;
}
