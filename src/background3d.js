import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#pi-3d-bg');

if (canvas) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const buildModelUrl = async () => {
    if (!('DecompressionStream' in window)) {
      throw new Error('gzip decompression is not supported');
    }

    const parts = await Promise.all(
      ['0', '1', '2', '3a', '3b', '3c', '4'].map(async (part) => {
        const response = await fetch(`./assets/pi-model/${part}.b64?v=20260810-1`);
        if (!response.ok) throw new Error(`3D model part ${part} failed to load`);
        return (await response.text()).trim();
      })
    );

    const encoded = parts.join('');
    const compressed = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();

    return URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  };

  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 5);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x151515, 2.2));

    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(3, 4, 5);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xffffff, 1.8);
    rim.position.set(-4, 1, -2);
    scene.add(rim);

    let rig = null;
    let modelWidth = 1;
    let pointerX = 0;
    let pointerY = 0;
    let smoothX = 0;
    let smoothY = 0;
    let frameId = 0;
    let lastFrame = 0;

    const resize = () => {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);

      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      if (!rig) return;

      const visibleHeight =
        2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.position.z;
      const visibleWidth = visibleHeight * camera.aspect;
      const targetWidth = Math.min(visibleWidth * 0.82, 3.15);
      rig.scale.setScalar(targetWidth / modelWidth);
    };

    const render = (time = performance.now()) => {
      if (!rig) return;

      if (!reduceMotion) {
        if (time - lastFrame < 16) {
          frameId = requestAnimationFrame(render);
          return;
        }

        lastFrame = time;
        smoothX += (pointerX - smoothX) * 0.035;
        smoothY += (pointerY - smoothY) * 0.035;
        rig.rotation.x = smoothY * 0.07;
        rig.rotation.y = time * 0.00009 + smoothX * 0.16;
      }

      renderer.render(scene, camera);
      if (!reduceMotion && !document.hidden) frameId = requestAnimationFrame(render);
    };

    const onPointerMove = (event) => {
      pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      pointerY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && rig && !reduceMotion) {
        cancelAnimationFrame(frameId);
        lastFrame = performance.now();
        frameId = requestAnimationFrame(render);
      }
    });

    resize();

    buildModelUrl()
      .then((modelUrl) => {
        const loader = new GLTFLoader();

        loader.load(
          modelUrl,
          ({ scene: gltfScene }) => {
            URL.revokeObjectURL(modelUrl);

            const box = new THREE.Box3().setFromObject(gltfScene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            modelWidth = Math.max(size.x, 0.0001);
            gltfScene.position.sub(center);

            gltfScene.traverse((node) => {
              if (!node.isMesh) return;
              node.frustumCulled = false;

              const materials = Array.isArray(node.material) ? node.material : [node.material];
              for (const material of materials) {
                if (!material) continue;
                if ('metalness' in material) material.metalness = 0.22;
                if ('roughness' in material) material.roughness = 0.34;
                material.needsUpdate = true;
              }
            });

            rig = new THREE.Group();
            rig.add(gltfScene);
            scene.add(rig);

            resize();
            render();
          },
          undefined,
          () => {
            URL.revokeObjectURL(modelUrl);
            canvas.remove();
          }
        );
      })
      .catch(() => canvas.remove());
  } catch {
    canvas.remove();
  }
}
