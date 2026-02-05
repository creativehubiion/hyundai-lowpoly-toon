console.log('lowpoly.js file loaded!');
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/**
 * Low Poly Scene - Simple viewer for low poly assets
 */

class LowPolyViewer {
  constructor() {
    this.container = document.getElementById('game-container');
    this.loadingScreen = document.getElementById('loading-screen');

    // Core Three.js
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Loaders
    this.gltfLoader = null;
    this.dracoLoader = null;
    this.rgbeLoader = null;

    // Helpers
    this.gridHelper = null;

    // Shared toon gradient map (recycled for all buildings)
    this.sharedGradientMap = null;

    // Road generation
    this.roadTemplates = {};
    this.roadPieces = [];
    this.roadBaseColorMap = null;
    this.occupiedCells = new Set();  // Grid-based collision tracking
    this.GRID_CELL_SIZE = 2;  // 2m grid cells
  }

  async init() {
    console.log('LowPolyViewer init starting...');
    this.setupRenderer();
    this.setupScene();
    this.setupLoaders();
    this.setupLighting();
    this.setupControls();
    this.setupHelpers();
    console.log('Setup complete, loading assets...');

    // Load environment map
    try {
      const envMap = await this.loadHDR('/kloofendal_48d_partly_cloudy_puresky_1k.hdr');
      this.scene.environment = envMap;
      console.log('Environment map loaded');
    } catch (error) {
      console.warn('HDR environment not found, using default lighting');
    }

    // Load house1
    const house1 = await this.loadModel('/Low%20Poly%20Env%20Exports/house1.glb');

    // Load house2 and place it beside house1
    const house2 = await this.loadModel('/Low%20Poly%20Env%20Exports/house2.glb');
    if (house2) {
      house2.position.x += 8;  // Offset to the right
    }

    // Load nuclear plant and place it next to houses
    const nuclearPlant = await this.loadModel('/Low%20Poly%20Env%20Exports/nuclearplant.glb');
    if (nuclearPlant) {
      nuclearPlant.position.x += 20;  // Further to the right
    }

    // Load car with specialized toon shader
    const car = await this.loadCar('/Low%20Poly%20Env%20Exports/car.glb');
    if (car) {
      car.position.x -= 8;  // Place to the left of houses
      car.position.z += 3;
    }

    // Load warehouse
    const warehouse = await this.loadModel('/Low%20Poly%20Env%20Exports/warehouse.glb');
    if (warehouse) {
      warehouse.position.x += 32;  // Place to the right of nuclear plant
    }

    // Road generation disabled for now
    // await this.loadRoadTemplates();
    // await this.generateRoad(15);

    // Hide loading screen
    this.hideLoadingScreen();

    // Start render loop
    this.animate();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG') this.toggleGrid();
    });

    console.log('%c Low Poly Scene Ready ', 'background: #74b9ff; color: #000; padding: 4px 8px; border-radius: 4px;');
    console.log('Controls: LMB Rotate | MMB Pan | Scroll Zoom | G Grid');
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // sRGB encoding makes colors pop
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // No tone mapping for crisp toon look
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.onResize());
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(10, 8, 10);
    this.camera.lookAt(0, 0, 0);
  }

  setupLoaders() {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.dracoLoader.setDecoderConfig({ type: 'js' });

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.rgbeLoader = new RGBELoader();
  }

  setupLighting() {
    // Hemisphere at high intensity - global light floor, no face ever black
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 2.0);
    this.scene.add(hemi);

    // Main Sun - high position for dramatic shadows in wheel wells and recesses
    const sun = new THREE.DirectionalLight(0xffffff, 5.0);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    // Rim Light - from back-top for body contrast against sky
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLight.position.set(-20, 30, -30);  // Behind and above
    this.scene.add(rimLight);
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100;
    this.controls.target.set(0, 1, 0);
  }

  setupHelpers() {
    this.gridHelper = new THREE.GridHelper(50, 50, 0xffffff, 0xffffff);
    this.gridHelper.material.opacity = 0.15;
    this.gridHelper.material.transparent = true;
    this.scene.add(this.gridHelper);

    // Axes helper
    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);
  }

  loadHDR(path) {
    return new Promise((resolve, reject) => {
      this.rgbeLoader.load(path, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        resolve(texture);
      }, undefined, reject);
    });
  }

  createToonGradientMap() {
    // Light slate blue shadow - ensures 'shadow' has color and brightness
    const colors = new Uint8Array([
      180, 190, 220, 255,  // Pixel 1: Light slate blue shadow (never black)
      210, 210, 210, 255,  // Pixel 2: Midtone
      255, 255, 255, 255   // Pixel 3: Highlight
    ]);
    const gradientMap = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
    gradientMap.needsUpdate = true;

    // CRITICAL: NearestFilter keeps sharp cell transitions
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;

    return gradientMap;
  }

  // Road-specific gradient (darker for asphalt look)
  createRoadGradientMap() {
    const colors = new Uint8Array([
      60, 60, 70, 255,     // Pixel 1: Dark asphalt shadow
      100, 100, 110, 255,  // Pixel 2: Mid asphalt
      160, 160, 170, 255   // Pixel 3: Light asphalt highlight
    ]);
    const gradientMap = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
    gradientMap.needsUpdate = true;
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    return gradientMap;
  }

  // 3-step gradient for reflective glass (Light Blue -> Navy -> White)
  createWindowGradientMap() {
    const colors = new Uint8Array([
      135, 180, 220, 255,  // Pixel 1: Light Blue (ambient reflection)
      20, 30, 60, 255,     // Pixel 2: Navy (shadow)
      255, 255, 255, 255   // Pixel 3: Pure White (specular highlight)
    ]);
    const gradientMap = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
    gradientMap.needsUpdate = true;
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    return gradientMap;
  }

  // Create outline by pushing vertices along normals
  createOutline(mesh, thickness = 0.015) {
    const geometry = mesh.geometry.clone();

    // Ensure normals exist on cloned geometry
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }

    // Push each vertex along its normal
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;

    if (position && normal) {
      for (let i = 0; i < position.count; i++) {
        position.setX(i, position.getX(i) + normal.getX(i) * thickness);
        position.setY(i, position.getY(i) + normal.getY(i) * thickness);
        position.setZ(i, position.getZ(i) + normal.getZ(i) * thickness);
      }
      position.needsUpdate = true;
    }

    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x0a0a1a,  // Dark navy
      side: THREE.BackSide
    });

    const outline = new THREE.Mesh(geometry, outlineMaterial);
    outline.castShadow = false;
    outline.receiveShadow = false;
    return outline;
  }

  async loadModel(path) {
    console.log(`Loading model: ${path}`);

    // Use shared gradient map (create once, reuse for all buildings)
    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }
    const gradientMap = this.sharedGradientMap;

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          path,
          resolve,
          (progress) => console.log(`Loading progress: ${(progress.loaded / progress.total * 100).toFixed(0)}%`),
          (error) => {
            console.error('GLTF Load Error:', error);
            reject(error);
          }
        );
      });

      const model = gltf.scene;

      // Collect meshes first (to avoid modifying during traversal)
      const meshes = [];
      model.traverse((node) => {
        if (node.isMesh) meshes.push(node);
      });

      // Apply MeshToonMaterial and add outlines
      meshes.forEach((node) => {
        const origMat = node.material;

        // Debug: log original material properties
        console.log(`  ${node.name}: color=${origMat.color?.getHexString()}, map=${!!origMat.map}, vertexColors=${node.geometry.attributes.color ? 'YES' : 'NO'}`);

        // Create toon material with emissive to prevent pure black
        const toonMat = new THREE.MeshToonMaterial({
          gradientMap: gradientMap,
          side: THREE.DoubleSide  // Render both sides of faces
        });

        // Copy color (default to white if none)
        if (origMat.color) {
          toonMat.color.copy(origMat.color);
        }

        // Use fixed light gray emissive for ALL materials (prevents black faces)
        // Lower intensity (0.2) keeps toon contrast sharp
        toonMat.emissive.set(0x8888aa);  // Light blue-gray
        toonMat.emissiveIntensity = 0.2;

        // Copy texture map if exists
        if (origMat.map) {
          toonMat.map = origMat.map;
        }

        // Enable vertex colors if the geometry has them
        if (node.geometry.attributes.color) {
          toonMat.vertexColors = true;
        }

        // Recompute normals to ensure light bands wrap correctly
        node.geometry.computeVertexNormals();

        node.material = toonMat;

        // Selective scaling: small meshes need thicker outlines
        // Calculate bounding box size to determine thickness
        node.geometry.computeBoundingBox();
        const bbox = node.geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const minDimension = Math.min(size.x, size.y, size.z);
        const polyCount = node.geometry.attributes.position.count;

        // Consistent outline thickness across all models
        let outlineThickness = 0.05;  // Base thickness for all meshes
        if (minDimension < 0.3 || polyCount < 50) {
          outlineThickness = 0.06;  // Slightly thicker for tiny details
        }

        console.log(`    Outline: ${node.name} size=${minDimension.toFixed(2)} polys=${polyCount} thick=${outlineThickness}`);

        // Add outline using normal-push technique
        const outline = this.createOutline(node, outlineThickness);
        node.add(outline);  // Add as child so it follows the mesh
      });

      // Center the model
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      model.position.x = -center.x;
      model.position.z = -center.z;
      model.position.y = -box.min.y; // Place on ground

      this.scene.add(model);

      console.log(`Model loaded: ${path}`);
      console.log(`  Size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);

      return model;
    } catch (error) {
      console.error(`Failed to load model: ${path}`, error);
      return null;
    }
  }

  // Specialized car loader with specific toon shader rules
  async loadCar(path) {
    console.log(`Loading car: ${path}`);

    // Use shared gradient map
    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }
    const gradientMap = this.sharedGradientMap;

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(
          path,
          resolve,
          (progress) => console.log(`Loading progress: ${(progress.loaded / progress.total * 100).toFixed(0)}%`),
          (error) => {
            console.error('GLTF Load Error:', error);
            reject(error);
          }
        );
      });

      const model = gltf.scene;

      // Collect meshes first
      const meshes = [];
      model.traverse((node) => {
        if (node.isMesh) meshes.push(node);
      });

      console.log('Car mesh hierarchy:');
      meshes.forEach((node) => {
        const origMat = node.material;
        const matName = origMat.name || 'unnamed';
        const meshNameLower = (node.name || '').toLowerCase();
        const isW = meshNameLower.includes('window') || meshNameLower.includes('glass') || matName.toLowerCase().includes('window');
        const isB = meshNameLower.includes('body');
        const isWh = meshNameLower.includes('wheel');
        console.log(`  ${node.name} | mat: ${matName} | map: ${!!origMat.map} | window:${isW} body:${isB} wheel:${isWh}`);
      });

      // Apply materials based on mesh/material names
      meshes.forEach((node) => {
        const origMat = node.material;
        const matName = (origMat.name || '').toLowerCase();
        const meshName = (node.name || '').toLowerCase();

        // Recompute normals for smooth toon bands (Depth Fix)
        node.geometry.computeVertexNormals();

        // Check if this is a window (check material name primarily)
        const isWindow = matName.includes('window');

        // Check if this is a wheel (check mesh name)
        const isWheel = meshName.includes('wheel') || meshName.includes('3dwheel');

        // Check if this is the main body (but not window or wheel)
        const isBody = (meshName.includes('body') || meshName.includes('car_body')) && !isWindow && !isWheel;

        let toonMat;

        if (isWindow) {
          // Windows: Dark tinted glass with sharp light catch
          const windowGradient = this.createWindowGradientMap();
          toonMat = new THREE.MeshToonMaterial({
            gradientMap: windowGradient,
            color: 0x1a1a2e,  // Dark navy base
            side: THREE.DoubleSide
          });
          // Emissive gives slight visibility in shadow
          toonMat.emissive.set(0x0a0a1a);
          toonMat.emissiveIntensity = 0.2;
          console.log(`    -> Window material applied: ${node.name}`);
        } else if (isBody) {
          // Car body: preserve original texture map
          toonMat = new THREE.MeshToonMaterial({
            gradientMap: gradientMap,
            side: THREE.DoubleSide
          });
          // Copy color
          if (origMat.color) {
            toonMat.color.copy(origMat.color);
          }
          // IMPORTANT: Preserve texture map for paint details
          if (origMat.map) {
            toonMat.map = origMat.map;
            console.log(`    -> Body with texture preserved: ${node.name}`);
          } else {
            console.log(`    -> Body (no texture): ${node.name}`);
          }
          // Emissive for depth fix
          toonMat.emissive.set(0x333333);
          toonMat.emissiveIntensity = 0.2;
        } else if (isWheel) {
          // Wheels: preserve texture, darker emissive
          toonMat = new THREE.MeshToonMaterial({
            gradientMap: gradientMap,
            side: THREE.DoubleSide
          });
          if (origMat.color) {
            toonMat.color.copy(origMat.color);
          }
          if (origMat.map) {
            toonMat.map = origMat.map;
          }
          // Emissive prevents pitch black wheels
          toonMat.emissive.set(0x333333);
          toonMat.emissiveIntensity = 0.2;
          console.log(`    -> Wheel material applied: ${node.name}`);
        } else {
          // General meshes: standard toon material
          toonMat = new THREE.MeshToonMaterial({
            gradientMap: gradientMap,
            side: THREE.DoubleSide
          });
          if (origMat.color) {
            toonMat.color.copy(origMat.color);
          }
          if (origMat.map) {
            toonMat.map = origMat.map;
          }
          // Global emissive to prevent pitch black (Depth Fix)
          toonMat.emissive.set(0x333333);
          toonMat.emissiveIntensity = 0.2;
        }

        // Enable vertex colors if present
        if (node.geometry.attributes.color) {
          toonMat.vertexColors = true;
        }

        node.material = toonMat;

        // Selective outlines and edge lines
        if (isBody) {
          // Body: silhouette outline + internal edge lines for door/hood gaps
          const outline = this.createCarOutline(node, 0.01);
          node.add(outline);

          // Car_Body_Main001 (main paint body) gets aggressive 15° to catch hood/door lines
          // Sub-meshes (Car_Body_Main001_1, _2, etc.) get 40° to stay clean
          const isMainBody = /car_body_main\d*$/i.test(node.name);  // Ends with numbers, no underscore suffix
          const edgeThreshold = isMainBody ? 15 : 40;
          const edgeLines = this.createEdgeLines(node, edgeThreshold);
          node.add(edgeLines);
          console.log(`    -> Body outline + edges (${edgeThreshold}°) added: ${node.name}`);
        } else if (isWheel) {
          // Wheels: silhouette outline only
          const outline = this.createCarOutline(node, 0.01);
          node.add(outline);
          console.log(`    -> Wheel outline added: ${node.name}`);
        }
      });

      // Center the car
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      model.position.x = -center.x;
      model.position.z = -center.z;
      model.position.y = -box.min.y; // Place on ground

      this.scene.add(model);

      console.log(`Car loaded: ${path}`);
      console.log(`  Size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);

      return model;
    } catch (error) {
      console.error(`Failed to load car: ${path}`, error);
      return null;
    }
  }

  // Create internal edge lines for showing creases (door gaps, hood lines)
  // Thinner and more subtle than silhouette outlines
  createEdgeLines(mesh, thresholdAngle = 40) {
    const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdAngle);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x1a1a2e,  // Dark navy - design lines not glitches
      linewidth: 1,
      transparent: true,
      opacity: 0.7,
      // Depth settings prevent lines being "eaten" by car paint
      depthTest: true,
      depthWrite: true
    });
    const edgeLines = new THREE.LineSegments(edges, lineMaterial);
    edgeLines.renderOrder = 1;  // Render after main mesh
    // Slight offset to prevent z-fighting with car surface
    lineMaterial.polygonOffset = true;
    lineMaterial.polygonOffsetFactor = -1;
    lineMaterial.polygonOffsetUnits = -1;
    return edgeLines;
  }

  // Create car outline with polygonOffset to prevent Z-fighting
  createCarOutline(mesh, thickness = 0.01) {
    const geometry = mesh.geometry.clone();

    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }

    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;

    if (position && normal) {
      for (let i = 0; i < position.count; i++) {
        position.setX(i, position.getX(i) + normal.getX(i) * thickness);
        position.setY(i, position.getY(i) + normal.getY(i) * thickness);
        position.setZ(i, position.getZ(i) + normal.getZ(i) * thickness);
      }
      position.needsUpdate = true;
    }

    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x0a0a1a,  // Dark navy
      side: THREE.BackSide,
      // Polygon offset to prevent Z-fighting
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 1.0
    });

    const outline = new THREE.Mesh(geometry, outlineMaterial);
    outline.castShadow = false;
    outline.receiveShadow = false;
    return outline;
  }

  // Simple test - load one road piece directly
  async loadTestRoad() {
    console.log('Loading test road...');

    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }

    // Load base color texture
    const textureLoader = new THREE.TextureLoader();
    const baseColorMap = await new Promise((resolve) => {
      textureLoader.load(
        '/Road%20Pack/Textures%20compressed/WebP%20Normal+AO/initialShadingGroup_Base_Color.webp',
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;  // GLB models use non-flipped UVs
          console.log('Road texture loaded');
          resolve(texture);
        },
        undefined,
        (err) => {
          console.warn('Failed to load road texture:', err);
          resolve(null);
        }
      );
    });

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load('/Road%20Pack/Road%20Pieces/road_long.glb', resolve, undefined, reject);
      });

      const road = gltf.scene;
      console.log('Road GLB loaded');

      // Collect meshes FIRST to avoid infinite recursion
      const meshes = [];
      road.traverse((node) => {
        if (node.isMesh) meshes.push(node);
      });

      console.log(`Found ${meshes.length} road meshes`);

      // Apply toon material with texture and outlines
      meshes.forEach((node) => {
        const toonMat = new THREE.MeshToonMaterial({
          gradientMap: this.sharedGradientMap,
          map: baseColorMap,
          color: 0xffffff,  // White to show texture colors correctly
          side: THREE.DoubleSide
        });
        node.material = toonMat;

        // Add outline
        const outline = this.createOutline(node, 0.03);
        node.add(outline);
      });

      // Position road in front of buildings
      road.position.set(0, 0, 3);
      this.scene.add(road);

      // Debug bounding box
      const box = new THREE.Box3().setFromObject(road);
      const size = box.getSize(new THREE.Vector3());
      console.log('Test road added - size:', size.x.toFixed(2), 'x', size.y.toFixed(2), 'x', size.z.toFixed(2));

    } catch (error) {
      console.error('Failed to load test road:', error);
    }
  }

  // Load all road piece templates
  async loadRoadTemplates() {
    console.log('Loading road templates...');

    // Load base color texture (WebP atlas)
    const textureLoader = new THREE.TextureLoader();
    this.roadBaseColorMap = await new Promise((resolve) => {
      textureLoader.load(
        '/Road%20Pack/Textures%20compressed/WebP%20Normal+AO/initialShadingGroup_Base_Color.webp',
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;  // GLB models use non-flipped UVs
          console.log('Road texture atlas loaded');
          resolve(texture);
        },
        undefined,
        () => {
          console.warn('Failed to load road texture');
          resolve(null);
        }
      );
    });

    // Load all 4 road pieces as templates
    const roadTypes = ['road_long', 'road_short', 'road_curve_wide', 'road_curve_tight'];
    for (const name of roadTypes) {
      const template = await this.loadRoadTemplate(name);
      if (template) {
        this.roadTemplates[name] = template;
      }
    }

    console.log('Road templates loaded:', Object.keys(this.roadTemplates));
  }

  // Load a single road template
  async loadRoadTemplate(name) {
    const path = `/Road%20Pack/Road%20Pieces/${name}.glb`;

    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(path, resolve, undefined, reject);
      });

      const model = gltf.scene;

      // Collect meshes first to avoid infinite recursion when adding outlines
      const meshes = [];
      model.traverse((node) => {
        if (node.isMesh) meshes.push(node);
      });

      // Apply toon material and outlines
      meshes.forEach((node) => {
        const toonMat = new THREE.MeshToonMaterial({
          gradientMap: this.sharedGradientMap,
          side: THREE.DoubleSide
        });

        if (this.roadBaseColorMap) {
          toonMat.map = this.roadBaseColorMap;
        } else {
          toonMat.color.set(0x4a4a52);
        }

        toonMat.emissive.set(0x333333);
        toonMat.emissiveIntensity = 0.15;

        node.geometry.computeVertexNormals();
        node.material = toonMat;

        // Simple silhouette outline
        const outline = this.createOutline(node, 0.03);
        node.add(outline);
      });

      // Keep template hidden
      model.visible = false;
      this.scene.add(model);

      // Get size
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      console.log(`  ${name}: ${size.x.toFixed(1)} x ${size.z.toFixed(1)}`);

      return model;
    } catch (error) {
      console.error(`Failed to load road template: ${name}`, error);
      return null;
    }
  }

  // Find socket_out in a model for snapping
  findSocketOut(model) {
    let socket = null;
    model.traverse((child) => {
      if (child.name.toLowerCase().includes('socket_out') || child.name.toLowerCase().includes('socket')) {
        socket = child;
      }
    });
    return socket;
  }

  // Get world transform of socket_out
  getSocketTransform(piece) {
    const socket = this.findSocketOut(piece);
    if (!socket) {
      console.warn('No socket_out found in piece');
      return null;
    }

    socket.updateMatrixWorld(true);

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    socket.getWorldPosition(position);
    socket.getWorldQuaternion(quaternion);

    return { position, quaternion };
  }

  // Spawn a road piece at given transform
  spawnRoadPiece(templateName, position, quaternion) {
    const template = this.roadTemplates[templateName];
    if (!template) {
      console.error(`Road template not found: ${templateName}`);
      return null;
    }

    const instance = template.clone(true);
    instance.visible = true;
    instance.traverse((child) => { child.visible = true; });

    instance.scale.set(2, 2, 2);  // Scale up road pieces 2x
    instance.position.copy(position);
    instance.quaternion.copy(quaternion);

    this.scene.add(instance);
    this.roadPieces.push(instance);

    return instance;
  }

  // Convert world position to grid cell key
  cellKey(x, z) {
    const gx = Math.round(x / this.GRID_CELL_SIZE);
    const gz = Math.round(z / this.GRID_CELL_SIZE);
    return `${gx},${gz}`;
  }

  // Sample points along road piece centerline to get occupied cells
  sampleRoadCells(piece) {
    const cells = [];
    const socket = this.findSocketOut(piece);
    if (!socket) return cells;

    // Get start (origin) and end (socket) positions in world space
    const start = new THREE.Vector3();
    piece.getWorldPosition(start);

    socket.updateMatrixWorld(true);
    const end = new THREE.Vector3();
    socket.getWorldPosition(end);

    // Sample every 1m along the centerline
    const distance = start.distanceTo(end);
    const steps = Math.max(1, Math.ceil(distance));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      cells.push(this.cellKey(x, z));
    }

    return cells;
  }

  // Check if cells collide with occupied cells (excluding recent pieces for seam tolerance)
  checkCollision(cells, recentCells = new Set()) {
    for (const cell of cells) {
      if (this.occupiedCells.has(cell) && !recentCells.has(cell)) {
        return true;  // Collision
      }
    }
    return false;
  }

  // Try to spawn a piece, checking for collisions
  trySpawnRoadPiece(pieceName, position, quaternion, previousPiece = null) {
    const template = this.roadTemplates[pieceName];
    if (!template) return null;

    // Create temporary clone to check collision
    const testInstance = template.clone(true);
    testInstance.visible = true;
    testInstance.traverse((child) => { child.visible = true; });
    testInstance.scale.set(2, 2, 2);
    testInstance.position.copy(position);
    testInstance.quaternion.copy(quaternion);

    // Must add to scene temporarily for world matrix calculations
    this.scene.add(testInstance);
    testInstance.updateMatrixWorld(true);

    // Get cells this piece would occupy
    const cells = this.sampleRoadCells(testInstance);

    // Build recent cells set (last 2 pieces for seam tolerance)
    const recentCells = new Set();
    const recentCount = Math.min(2, this.roadPieces.length);
    for (let i = this.roadPieces.length - recentCount; i < this.roadPieces.length; i++) {
      if (i >= 0) {
        const recentPieceCells = this.sampleRoadCells(this.roadPieces[i]);
        recentPieceCells.forEach(c => recentCells.add(c));
      }
    }

    // Check collision
    if (this.checkCollision(cells, recentCells)) {
      // Remove test instance and reject
      this.scene.remove(testInstance);
      return null;
    }

    // No collision - keep the test instance as the actual piece
    // Mark cells as occupied
    cells.forEach(c => this.occupiedCells.add(c));
    this.roadPieces.push(testInstance);

    return testInstance;
  }

  // Generate procedural road by snapping pieces
  async generateRoad(count = 10) {
    console.log(`Generating ${count} road pieces...`);

    // Clear existing pieces and occupied cells
    this.roadPieces.forEach(p => this.scene.remove(p));
    this.roadPieces = [];
    this.occupiedCells.clear();

    // Start position
    let currentPos = new THREE.Vector3(0, 0, 0);
    let currentQuat = new THREE.Quaternion();

    // Track consecutive failures to avoid infinite loops
    let consecutiveFailures = 0;
    const maxFailures = 5;

    // Spawn pieces
    for (let i = 0; i < count && consecutiveFailures < maxFailures; i++) {
      // Piece selection priority (try straights first when recovering from collision)
      const pieceOptions = consecutiveFailures > 0
        ? ['road_long', 'road_short']  // Prefer straight when stuck
        : ['road_long', 'road_short', 'road_curve_wide', 'road_curve_tight'];

      let piece = null;

      // Try different pieces until one fits
      for (const pieceName of this.shuffleArray([...pieceOptions])) {
        piece = this.trySpawnRoadPiece(pieceName, currentPos, currentQuat);
        if (piece) break;
      }

      if (!piece) {
        consecutiveFailures++;
        console.warn(`Road piece ${i} collision - attempt ${consecutiveFailures}/${maxFailures}`);
        continue;
      }

      consecutiveFailures = 0;

      // Get socket for next piece
      const socketTransform = this.getSocketTransform(piece);
      if (socketTransform) {
        currentPos = socketTransform.position;
        currentQuat = socketTransform.quaternion;
      }
    }

    console.log(`Generated ${this.roadPieces.length} road pieces`);
  }

  // Fisher-Yates shuffle
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Simple road loader (legacy) - toon material with base color texture
  async loadRoad(path) {
    console.log(`Loading road: ${path}`);

    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }
    const gradientMap = this.sharedGradientMap;

    // Load road base color texture atlas (shared across all roads)
    if (!this.roadBaseColorMap) {
      const textureLoader = new THREE.TextureLoader();
      this.roadBaseColorMap = await new Promise((resolve) => {
        textureLoader.load(
          '/Road%20Pack/Textures%20compressed/Normal+AO/initialShadingGroup_Base_Color.png',
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            // Don't modify wrap/repeat - let the model's UVs handle atlas mapping
            texture.flipY = false;  // GLB models typically use non-flipped UVs
            console.log('Road base color texture atlas loaded');
            resolve(texture);
          },
          undefined,
          () => {
            console.warn('Failed to load road texture, using fallback color');
            resolve(null);
          }
        );
      });
    }

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(path, resolve, undefined, reject);
      });

      const model = gltf.scene;

      // Apply toon material to all meshes
      model.traverse((node) => {
        if (node.isMesh) {
          const origMat = node.material;

          // Toon material with base color texture
          const toonMat = new THREE.MeshToonMaterial({
            gradientMap: gradientMap,
            side: THREE.DoubleSide
          });

          // Apply loaded base color texture
          if (this.roadBaseColorMap) {
            toonMat.map = this.roadBaseColorMap;
          } else if (origMat.color) {
            toonMat.color.copy(origMat.color);
          }

          // Light emissive to prevent dark patches
          toonMat.emissive.set(0x333333);
          toonMat.emissiveIntensity = 0.15;

          node.geometry.computeVertexNormals();
          node.material = toonMat;

          console.log(`  Road mesh: ${node.name}, textured: ${!!this.roadBaseColorMap}`);
        }
      });

      this.scene.add(model);
      console.log(`Road loaded: ${path}`);

      return model;
    } catch (error) {
      console.error(`Failed to load road: ${path}`, error);
      return null;
    }
  }

  toggleGrid() {
    this.gridHelper.visible = !this.gridHelper.visible;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  hideLoadingScreen() {
    this.loadingScreen.classList.add('hidden');
    setTimeout(() => { this.loadingScreen.style.display = 'none'; }, 500);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Start
const viewer = new LowPolyViewer();
viewer.init().catch(console.error);
window.viewer = viewer;
