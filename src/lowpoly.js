console.log('lowpoly.js file loaded!');

// Global error handler to catch iOS crashes
window.onerror = function(msg, url, line, col, error) {
  console.error('Global error:', msg, 'at', url, line, col);
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;background:red;color:white;padding:10px;z-index:99999;font-size:12px;word-wrap:break-word;';
  errorDiv.textContent = `Error: ${msg} (line ${line})`;
  document.body.appendChild(errorDiv);
  return false;
};

window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'position:fixed;top:50px;left:10px;right:10px;background:orange;color:black;padding:10px;z-index:99999;font-size:12px;word-wrap:break-word;';
  errorDiv.textContent = `Promise rejected: ${event.reason}`;
  document.body.appendChild(errorDiv);
});

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Helper to get asset path with Vite base URL (for GitHub Pages deployment)
const getAssetPath = (path) => {
  const base = import.meta.env.BASE_URL || '/';
  // Remove leading slash from path if base already ends with one
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return base + cleanPath;
};

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

    // Ground tile system
    this.groundTiles = [];
    this.TILE_SIZE = 10;  // 10x10 meter tiles

    // World grid occupancy system (prevents overlapping tiles)
    this.worldGrid = new Map();  // Key: "x,z" -> Value: { type: 'grass'|'road', mesh: THREE.Mesh }

    // Skybox cubemap (for background and window reflections)
    this.skyboxCubemap = null;

    // Car reference
    this.car = null;

    // Transform controls for scene composition
    this.transformControls = null;
    this.selectableObjects = [];  // Objects that can be selected/transformed
    this.selectedObject = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Scene management
    this.defaultSceneState = null;  // Stores initial transforms
    this.savedScenes = {};  // Named scenes
    this.currentSceneName = null;

    // Camera view management
    this.currentCameraViews = { 'Default': null };  // Named camera views for current scene
    this.activeCameraView = 'Default';

    // Undo history
    this.undoHistory = [];
    this.MAX_UNDO_STEPS = 50;
  }

  async init() {
    console.log('LowPolyViewer init starting...');

    try {
      this.setupRenderer();
      console.log('Renderer OK');
    } catch (e) {
      this.showError('Renderer failed: ' + e.message);
      return;
    }

    try {
      this.setupScene();
      console.log('Scene OK');
    } catch (e) {
      this.showError('Scene failed: ' + e.message);
      return;
    }

    this.setupLoaders();
    this.setupLighting();
    this.setupControls();
    this.setupHelpers();
    console.log('Setup complete, loading assets...');

    // Load stylized skybox cubemap
    // iOS: use smaller non-upscaled PNG (less memory)
    // Android/Desktop: use upscaled webp
    try {
      if (this.isIOS) {
        // iOS: use smaller PNG cubemap (upscaled crashes iOS WebKit)
        const skyboxPath = getAssetPath('sky_44_2k/sky_44_cubemap_2k/');
        this.skyboxCubemap = await this.loadSkybox(skyboxPath, 'png');
        console.log('Skybox loaded (iOS - smaller png)');
      } else {
        const skyboxPath = getAssetPath('sky_44_2k/sky_44_cubemap_2k/upscaled/');
        this.skyboxCubemap = await this.loadSkybox(skyboxPath, 'webp');
        console.log('Skybox loaded (webp)');
      }
      this.scene.background = this.skyboxCubemap;
      this.scene.backgroundIntensity = this.isMobile ? 1.5 : 1.8;
      this.scene.fog = new THREE.Fog(0xd0e0ff, this.isMobile ? 30 : 20, this.isMobile ? 120 : 100);
    } catch (error) {
      console.warn('Skybox failed, using sky color:', error.message);
      this.scene.background = new THREE.Color(0x87ceeb);
      this.scene.fog = new THREE.Fog(0x87ceeb, 30, 150);
      this.skyboxCubemap = null;
    }

    // Building model paths
    const buildingPaths = {
      'apartment1': getAssetPath('Low%20Poly%20Env%20Exports/apartment1.glb'),
      'autoshop': getAssetPath('Low%20Poly%20Env%20Exports/autoshop.glb'),
      'building1': getAssetPath('Low%20Poly%20Env%20Exports/building1.glb'),
      'factory': getAssetPath('Low%20Poly%20Env%20Exports/factory.glb'),
      'house1': getAssetPath('Low%20Poly%20Env%20Exports/house1.glb'),
      'house2': getAssetPath('Low%20Poly%20Env%20Exports/house2.glb'),
      'house3': getAssetPath('Low%20Poly%20Env%20Exports/house3.glb'),
      'house4': getAssetPath('Low%20Poly%20Env%20Exports/house4.glb'),
      'nuclearPlant': getAssetPath('Low%20Poly%20Env%20Exports/nuclearplant.glb'),
      'office': getAssetPath('Low%20Poly%20Env%20Exports/office.glb'),
      'roadbarrier1': getAssetPath('Low%20Poly%20Env%20Exports/roadbarrier1.glb'),
      'trafficlight1': getAssetPath('Low%20Poly%20Env%20Exports/trafficlight1.glb'),
      'tree1': getAssetPath('Low%20Poly%20Env%20Exports/tree1.glb'),
      'warehouse': getAssetPath('Low%20Poly%20Env%20Exports/warehouse.glb'),
    };

    // Scene layout - buildings along the road
    // iOS: load only nearby buildings to prevent memory crash
    const fullSceneLayout = [
      { name: "apartment1_4", type: "apartment1", x: 2.86, z: -19.55, rot: -90 },
      { name: "autoshop_4", type: "autoshop", x: 3.04, z: -30.38, rot: 0 },
      { name: "building1_4", type: "building1", x: -2.87, z: -18.97, rot: 90 },
      { name: "factory_4", type: "factory", x: -4.1, z: -45.44, rot: 0 },
      { name: "house1_2", type: "house1", x: -2.74, z: -21.62, rot: 90 },
      { name: "house2_3", type: "house2", x: 2.92, z: -16.23, rot: -90 },
      { name: "house3_1", type: "house3", x: 2.99, z: -23.47, rot: -90 },
      { name: "house3_4", type: "house3", x: 2.45, z: -34.98, rot: -90 },
      { name: "house4_4", type: "house4", x: -2.64, z: -24.73, rot: 90 },
      { name: "nuclearPlant_1", type: "nuclearPlant", x: -6.2, z: -33.7, rot: 0 },
      { name: "office_1", type: "office", x: 4.38, z: -46.81, rot: 0 },
      { name: "office_2", type: "office", x: -4.35, z: -39.92, rot: 0 },
      { name: "roadbarrier1_2", type: "roadbarrier1", x: 0.98, z: -29.45, rot: 0 },
      { name: "roadbarrier1_4", type: "roadbarrier1", x: -0.94, z: -29.44, rot: 0 },
      { name: "roadbarrier1_5", type: "roadbarrier1", x: -0.03, z: -29.45, rot: 0 },
      { name: "trafficlight1_1", type: "trafficlight1", x: -1.7, z: -25.62, rot: 0 },
      { name: "tree1_1", type: "tree1", x: 2.34, z: -25.06, rot: 0 },
      { name: "tree1_4", type: "tree1", x: 2.21, z: -33.35, rot: -90 },
      { name: "warehouse_1", type: "warehouse", x: 8.85, z: -33.28, rot: 0 },
      { name: "warehouse_3", type: "warehouse", x: 5.95, z: -39.84, rot: -90 },
    ];

    // iOS test: all buildings, no cubemap
    const sceneLayout = fullSceneLayout;

    // Cache loaded models for reuse (remove from scene after loading)
    const modelCache = {};

    // Load and place each building
    for (const item of sceneLayout) {
      // Load model if not cached
      if (!modelCache[item.type]) {
        const loaded = await this.loadModel(buildingPaths[item.type]);
        if (loaded) {
          // Remove from scene - we only use it as a template for cloning
          this.scene.remove(loaded);
          modelCache[item.type] = loaded;
        }
      }

      const template = modelCache[item.type];
      if (template) {
        const model = template.clone(true);
        model.position.set(item.x, 0, item.z);
        model.rotation.y = item.rot * Math.PI / 180;
        this.scene.add(model);
        this.registerSelectable(model, item.name);
      }
    }

    // Load car with specialized toon shader
    this.car = await this.loadCar(getAssetPath('Low%20Poly%20Env%20Exports/car.glb'));
    if (this.car) {
      this.car.scale.set(0.5, 0.5, 0.5);  // Half size
      this.car.position.x -= 8;
      this.car.position.z += 3;
      this.registerSelectable(this.car, 'car');
    }

    // Setup road reflection camera BEFORE roads are created
    this.setupRoadReflectionCamera();

    // Road System 1 (disabled) - Procedural generation with collision detection
    // await this.spawnProceduralRoadSystem1(100);

    // Road System 2 (disabled) - Network with Road1 and RoadX (intersection)
    // await this.spawnRoadNetworkSystem2(30);

    // Road System 3 - Spine-and-Branch generator
    await this.spawnSpineAndBranchSystem3();

    // Setup CubeCamera for real-time puddle reflections
    this.setupPuddleCubeCamera();

    // Spawn reflective puddles on the road
    this.spawnPuddles();

    // Generate ground grid (smaller on mobile)
    this.generateGroundGrid(this.isMobile ? 10 : 20);

    // Spawn utility poles along the road
    this.spawnUtilityPoles();

    // Setup transform controls for scene composition
    this.setupTransformControls();

    // Setup scene manager UI
    this.setupSceneManager();

    // Setup building spawner UI
    this.setupBuildingSpawner();

    // Save default scene state (after all objects loaded)
    this.saveDefaultSceneState();

    // Check for scene in URL parameter (for sharing)
    await this.loadSceneFromURL();

    // Hide loading screen
    this.hideLoadingScreen();

    // Capture static reflections (one-time, after everything loads)
    // Use setTimeout to ensure all models are fully rendered
    setTimeout(() => {
      this.captureStaticPuddleReflections();
      this.captureRoadReflections();
    }, 100);

    // Start render loop
    this.animate();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG') this.toggleGrid();
      if (e.code === 'KeyT') this.setTransformMode('translate');
      if (e.code === 'KeyR') this.setTransformMode('rotate');
      if (e.code === 'KeyY') this.setTransformMode('scale');
      if (e.code === 'Escape') this.deselectObject();
      if (e.code === 'KeyP') this.printSelectedPosition();
      if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSelectedObject();
      if (e.code === 'KeyX' && e.shiftKey) this.exportRemainingBuildings();

      // Shift+C: Reset camera to origin
      if (e.shiftKey && e.code === 'KeyC') {
        this.resetCameraToOrigin();
      }

      // Ctrl+Z: Undo
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        this.undo();
      }

      // +/- or =/- keys: Precise zoom for screenshots
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        this.preciseZoom(0.1); // Zoom in
      }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        this.preciseZoom(-0.1); // Zoom out
      }

      // H: Hide/show UI for screenshots
      if (e.code === 'KeyH') {
        this.toggleUI();
      }

      // Shift held: snap rotation to 90 degrees
      if (e.shiftKey && this.transformControls) {
        this.transformControls.setRotationSnap(Math.PI / 2);  // 90 degrees
        this.transformControls.setTranslationSnap(1);  // 1 unit grid snap
      }
    });

    document.addEventListener('keyup', (e) => {
      // Shift released: disable snapping
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (this.transformControls) {
          this.transformControls.setRotationSnap(null);
          this.transformControls.setTranslationSnap(null);
        }
      }
    });

    // Click to select objects
    this.renderer.domElement.addEventListener('click', (e) => this.onClickSelect(e));

    console.log('%c Low Poly Scene Ready ', 'background: #74b9ff; color: #000; padding: 4px 8px; border-radius: 4px;');
    console.log('Controls: LMB Rotate | MMB Pan | Scroll Zoom | G Grid');
    console.log('Transform: Click to select | T Translate | R Rotate | Y Scale | Esc Deselect | P Print position');
  }

  setupRenderer() {
    // Detect mobile and iOS for performance optimizations
    this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    this.isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,  // Enable antialiasing on all devices
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Use device pixel ratio (capped at 2 for performance)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // sRGB encoding makes colors pop
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACESFilmic tone mapping for moody wet look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;  // Crush blacks for high-contrast cinematic look
    // Enable shadow maps - disable on mobile for performance
    this.renderer.shadowMap.enabled = !this.isMobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.onResize());

    if (this.isMobile) {
      console.log('Mobile detected - using performance optimizations');
      // Hide hotkey hints on mobile (not useful for touch)
      const controlsHint = document.getElementById('controls-hint');
      if (controlsHint) {
        controlsHint.style.display = 'none';
      }
    }
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Lower camera to spoiler level, tilted up to capture skybox
    this.camera.position.set(8, 2, 12);
    this.camera.lookAt(0, 3, 0);  // Look slightly upward
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
    // Hemisphere light - deep indigo ground for anime navy shadow tint
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2d2d44, 2.0);
    this.scene.add(hemi);

    // Main Sun - balanced intensity to avoid blowing out whites
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.position.set(30, 60, 20);

    // Enable shadow casting
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.width = 2048;   // High res for smooth shadows
    this.sun.shadow.mapSize.height = 2048;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 500;
    this.sun.shadow.camera.left = -25;      // Tight frustum focused on car area
    this.sun.shadow.camera.right = 25;
    this.sun.shadow.camera.top = 25;
    this.sun.shadow.camera.bottom = -25;
    this.sun.shadow.bias = -0.0008;       // Kill shadow acne
    this.sun.shadow.normalBias = 0.05;    // Clean look on angled faces
    this.sun.shadow.radius = 4;           // Tight blur for intentional look

    this.scene.add(this.sun);

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
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 500;
    this.controls.zoomSpeed = 1.5;
    this.controls.target.set(0, 2, 0);  // Focus slightly above ground for better skybox view

    // Blender-style controls: MMB rotate, Shift+MMB pan, RMB pan
    this.controls.mouseButtons = {
      LEFT: null,  // Reserved for selection
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN
    };

    // MacBook trackpad support: Option(Alt)+drag to rotate (no middle mouse button)
    // Use pointerdown with capture phase so this runs BEFORE OrbitControls processes the event
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && event.altKey) {
        // Option/Alt+click enables rotation with left mouse
        this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      }
    }, true);  // capture phase

    this.renderer.domElement.addEventListener('pointerup', (event) => {
      if (event.button === 0) {
        // Reset left mouse back to selection mode
        this.controls.mouseButtons.LEFT = null;
      }
    }, true);  // capture phase

    // Mobile: enable built-in pinch-to-zoom
    // Desktop: disable zoom, use custom infinite dolly instead
    if (this.isMobile) {
      this.controls.enableZoom = true;
      this.controls.zoomSpeed = 1.0;
      // Touch controls: one finger rotate, two finger zoom/pan
      this.controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      };
      console.log('Mobile touch controls enabled: 1-finger rotate, 2-finger zoom/pan');

      // Add zoom buttons for mobile
      this.setupMobileZoomButtons();
    } else {
      this.controls.enableZoom = false;

      // Custom infinite zoom: dolly camera forward/backward in look direction
      this.renderer.domElement.addEventListener('wheel', (event) => {
        event.preventDefault();

        // Get camera's forward direction
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);

        // Dolly speed: Ctrl = ultra-fine (10x more precise), normal = standard
        const baseSpeed = event.ctrlKey ? 0.0005 : 0.005;
        const dollyAmount = event.deltaY * baseSpeed;

        // Move both camera and target along the forward direction
        const movement = forward.multiplyScalar(-dollyAmount);
        this.camera.position.add(movement);
        this.controls.target.add(movement);
      }, { passive: false });
    }
  }

  setupTransformControls() {
    // Skip on mobile - not useful for touch interaction
    if (this.isMobile) {
      console.log('Mobile detected - skipping transform controls');
      this.transformControls = null;
      return;
    }

    try {
      // Create TransformControls
      this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
      this.transformControls.setSize(1.0);

      // Capture state before transform starts (for undo)
      this.transformControls.addEventListener('mouseDown', () => {
        this.pushUndoState();
      });

      // Disable orbit controls while transforming
      this.transformControls.addEventListener('dragging-changed', (event) => {
        this.controls.enabled = !event.value;
      });

      // Add the gizmo helper to scene (this is what renders the axes)
      const gizmo = this.transformControls.getHelper();
      this.scene.add(gizmo);

      console.log('Transform controls ready');
    } catch (err) {
      console.error('Failed to setup transform controls:', err);
      this.transformControls = null;
    }
  }

  pushUndoState() {
    const state = this.captureSceneState();
    this.undoHistory.push(state);
    // Limit history size
    if (this.undoHistory.length > this.MAX_UNDO_STEPS) {
      this.undoHistory.shift();
    }
    console.log(`Undo state saved (${this.undoHistory.length} steps)`);
  }

  undo() {
    if (this.undoHistory.length === 0) {
      console.log('Nothing to undo');
      return;
    }
    const state = this.undoHistory.pop();
    this.applySceneState(state);
    console.log(`Undo applied (${this.undoHistory.length} steps remaining)`);
  }

  setTransformMode(mode) {
    if (this.transformControls) {
      this.transformControls.setMode(mode);
      console.log(`Transform mode: ${mode}`);
    }
  }

  selectObject(object) {
    if (!this.transformControls) {
      console.error('Transform controls not initialized!');
      return;
    }
    this.selectedObject = object;
    this.transformControls.attach(object);
    this.transformControls.visible = true;
    console.log(`Selected: ${object.name || 'unnamed'}, transform attached:`, this.transformControls.object === object);
    console.log('Transform controls visible:', this.transformControls.visible, 'in scene:', this.transformControls.parent === this.scene);
  }

  deselectObject() {
    this.selectedObject = null;
    if (this.transformControls) {
      this.transformControls.detach();
    }
    console.log('Deselected');
  }

  deleteSelectedObject() {
    if (!this.selectedObject) {
      console.log('Nothing selected to delete');
      return;
    }

    const name = this.selectedObject.name || 'unnamed object';

    // Detach transform controls first
    if (this.transformControls) {
      this.transformControls.detach();
    }

    // Remove from selectableObjects array
    const index = this.selectableObjects.indexOf(this.selectedObject);
    if (index > -1) {
      this.selectableObjects.splice(index, 1);
    }

    // Remove from scene
    this.scene.remove(this.selectedObject);

    // Dispose of geometry and materials to free memory
    this.selectedObject.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    console.log(`Deleted: ${name}`);
    this.selectedObject = null;
  }

  exportRemainingBuildings() {
    // Get all remaining selectable objects with positions
    const remaining = this.selectableObjects
      .filter(obj => obj.name && obj.name !== 'car')
      .map(obj => ({
        name: obj.name,
        position: {
          x: Math.round(obj.position.x * 100) / 100,
          y: Math.round(obj.position.y * 100) / 100,
          z: Math.round(obj.position.z * 100) / 100
        },
        rotation: Math.round(obj.rotation.y * 180 / Math.PI)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log('=== SCENE EXPORT (copy this) ===');
    console.log(JSON.stringify(remaining, null, 2));
    console.log('=== END ===');
  }

  onClickSelect(event) {
    // Ignore if Alt/Ctrl/Shift held (used for camera controls)
    if (event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    // Ignore if transform controls not ready yet
    if (!this.transformControls) {
      return;
    }

    // Calculate mouse position in normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    console.log(`Click at (${this.mouse.x.toFixed(2)}, ${this.mouse.y.toFixed(2)}), selectables: ${this.selectableObjects.length}`);

    // Raycast against all scene objects, not just selectables
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    console.log(`Raycast hits: ${intersects.length}`);

    if (intersects.length > 0) {
      // Walk up to find a selectable parent
      for (const hit of intersects) {
        let target = hit.object;
        console.log(`Hit: ${target.name || target.type}, distance: ${hit.distance.toFixed(2)}`);

        // Walk up the parent hierarchy to find a selectable root
        while (target) {
          if (this.selectableObjects.includes(target)) {
            console.log(`Found selectable: ${target.name}`);
            this.selectObject(target);
            return;
          }
          target = target.parent;
        }
      }
    }

    // Clicked outside any selectable object - deselect
    console.log('No selectable hit, deselecting');
    this.deselectObject();
  }

  printSelectedPosition() {
    if (this.selectedObject) {
      const p = this.selectedObject.position;
      const r = this.selectedObject.rotation;
      console.log(`Position: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      console.log(`Rotation: (${THREE.MathUtils.radToDeg(r.x).toFixed(1)}°, ${THREE.MathUtils.radToDeg(r.y).toFixed(1)}°, ${THREE.MathUtils.radToDeg(r.z).toFixed(1)}°)`);
    }
  }

  // Register an object as selectable for transform controls
  registerSelectable(object, name) {
    object.name = name || object.name || 'object';
    this.selectableObjects.push(object);
  }

  // Mobile zoom buttons and UI toggle
  setupMobileZoomButtons() {
    // Container for mobile controls (bottom right)
    const container = document.createElement('div');
    container.id = 'mobile-controls';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 1000;
    `;

    // Button style
    const btnStyle = `
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: none;
      background: rgba(0,0,0,0.6);
      color: white;
      font-size: 24px;
      font-weight: bold;
      cursor: pointer;
      touch-action: manipulation;
      user-select: none;
    `;

    // Zoom In button
    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.style.cssText = btnStyle;
    zoomIn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.mobileZoom(1);
    });
    zoomIn.addEventListener('touchend', () => this.stopMobileZoom());

    // Zoom Out button
    const zoomOut = document.createElement('button');
    zoomOut.textContent = '-';
    zoomOut.style.cssText = btnStyle;
    zoomOut.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.mobileZoom(-1);
    });
    zoomOut.addEventListener('touchend', () => this.stopMobileZoom());

    // UI Toggle button - just hide/show, don't open menus
    const uiToggle = document.createElement('button');
    uiToggle.innerHTML = '&#128065;'; // eye icon
    uiToggle.style.cssText = btnStyle;
    uiToggle.style.fontSize = '20px';
    this.uiVisible = true;
    uiToggle.addEventListener('click', () => {
      this.uiVisible = !this.uiVisible;
      // Toggle visibility of all UI elements (keeps state, just hides)
      const uiElements = [
        'menu-toggle', 'scene-panel', 'building-toggle', 'building-panel',
        'scene-menu', 'building-menu'
      ];
      uiElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = this.uiVisible ? 'visible' : 'hidden';
      });
      // Also hide/show zoom buttons
      zoomIn.style.visibility = this.uiVisible ? 'visible' : 'hidden';
      zoomOut.style.visibility = this.uiVisible ? 'visible' : 'hidden';
      uiToggle.style.background = this.uiVisible ? 'rgba(0,0,0,0.6)' : 'rgba(100,0,0,0.6)';
    });

    container.appendChild(zoomIn);
    container.appendChild(zoomOut);
    container.appendChild(uiToggle);
    document.body.appendChild(container);

    // Zoom animation state
    this.mobileZoomDirection = 0;
    this.mobileZoomInterval = null;
  }

  mobileZoom(direction) {
    this.mobileZoomDirection = direction;
    if (this.mobileZoomInterval) return;

    this.mobileZoomInterval = setInterval(() => {
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      const speed = 0.04;  // Very slow zoom
      this.camera.position.addScaledVector(forward, speed * this.mobileZoomDirection);
      this.controls.target.addScaledVector(forward, speed * this.mobileZoomDirection);
    }, 16);
  }

  stopMobileZoom() {
    this.mobileZoomDirection = 0;
    if (this.mobileZoomInterval) {
      clearInterval(this.mobileZoomInterval);
      this.mobileZoomInterval = null;
    }
  }

  // Scene Management Methods
  setupSceneManager() {
    // Load saved scenes from localStorage
    const stored = localStorage.getItem('lowpoly_scenes');
    if (stored) {
      this.savedScenes = JSON.parse(stored);
    }

    // Menu toggle
    const menuToggle = document.getElementById('menu-toggle');
    const scenePanel = document.getElementById('scene-panel');
    menuToggle.addEventListener('click', () => {
      scenePanel.style.display = scenePanel.style.display === 'none' ? 'block' : 'none';
    });

    // Save scene button
    document.getElementById('save-scene-btn').addEventListener('click', () => {
      const nameInput = document.getElementById('scene-name-input');
      const name = nameInput.value.trim() || `Scene ${Object.keys(this.savedScenes).length + 1}`;
      this.saveScene(name);
      nameInput.value = '';
    });

    // Default scene button
    document.getElementById('default-scene-btn').addEventListener('click', () => {
      this.loadDefaultScene();
    });

    // Share scene button
    const shareBtn = document.getElementById('share-scene-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => this.shareScene());
    }

    // Push to GitHub button
    const pushBtn = document.getElementById('push-github-btn');
    if (pushBtn) {
      pushBtn.addEventListener('click', () => this.pushToGitHub());
    }

    // Clear GitHub token button
    const clearTokenBtn = document.getElementById('clear-token-btn');
    if (clearTokenBtn) {
      clearTokenBtn.addEventListener('click', () => this.clearGitHubToken());
    }

    // Save camera view button
    const saveCamBtn = document.getElementById('save-camera-btn');
    if (saveCamBtn) {
      saveCamBtn.addEventListener('click', () => this.saveCameraView());
    }

    // Render initial lists
    this.renderSceneList();
    this.renderCameraViewList();
  }

  setupBuildingSpawner() {
    // Building paths mapping
    this.buildingPaths = {
      'house1': getAssetPath('Low%20Poly%20Env%20Exports/house1.glb'),
      'house2': getAssetPath('Low%20Poly%20Env%20Exports/house2.glb'),
      'house3': getAssetPath('Low%20Poly%20Env%20Exports/house3.glb'),
      'nuclearplant': getAssetPath('Low%20Poly%20Env%20Exports/nuclearplant.glb'),
      'warehouse': getAssetPath('Low%20Poly%20Env%20Exports/warehouse.glb'),
      'office': getAssetPath('Low%20Poly%20Env%20Exports/office.glb'),
      'tree1': getAssetPath('Low%20Poly%20Env%20Exports/tree1.glb'),
      'trafficlight1': getAssetPath('Low%20Poly%20Env%20Exports/trafficlight1.glb'),
      'roadbarrier1': getAssetPath('Low%20Poly%20Env%20Exports/roadbarrier1.glb'),
      'apartment1': getAssetPath('Low%20Poly%20Env%20Exports/apartment1.glb'),
      'building1': getAssetPath('Low%20Poly%20Env%20Exports/building1.glb'),
      'house4': getAssetPath('Low%20Poly%20Env%20Exports/house4.glb'),
      'autoshop': getAssetPath('Low%20Poly%20Env%20Exports/autoshop.glb'),
      'factory': getAssetPath('Low%20Poly%20Env%20Exports/factory.glb'),
    };

    // Menu toggle
    const buildingToggle = document.getElementById('building-toggle');
    const buildingPanel = document.getElementById('building-panel');
    buildingToggle.addEventListener('click', () => {
      buildingPanel.style.display = buildingPanel.style.display === 'none' ? 'block' : 'none';
    });

    // Spawn buttons
    document.querySelectorAll('.spawn-building-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.spawnBuilding(btn.dataset.building);
      });
    });
  }

  async spawnBuilding(type) {
    const path = this.buildingPaths[type];
    if (!path) {
      console.error(`Unknown building type: ${type}`);
      return;
    }

    // Push undo state before spawning
    this.pushUndoState();

    const building = await this.loadModel(path);
    if (building) {
      // Spawn at camera target position
      building.position.copy(this.controls.target);
      building.position.y = 0;

      // Mark as spawned object for scene save/load
      building.userData.spawnedType = type;

      // Generate unique name
      const count = this.selectableObjects.filter(o => o.name.startsWith(type)).length + 1;
      const name = `${type}_${count}`;
      this.registerSelectable(building, name);

      // Auto-select the new building
      this.selectObject(building);

      console.log(`Spawned ${name} at (${building.position.x.toFixed(1)}, ${building.position.z.toFixed(1)})`);
    }
  }

  saveDefaultSceneState() {
    this.defaultSceneState = this.captureSceneState();
    console.log('Default scene state saved');
  }

  // Capture current camera state
  captureCameraState() {
    return {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      },
      target: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z
      },
      zoom: this.camera.zoom
    };
  }

  // Apply a camera state
  applyCameraState(camState) {
    if (!camState) return;
    if (camState.position) {
      this.camera.position.set(camState.position.x, camState.position.y, camState.position.z);
    }
    if (camState.target) {
      this.controls.target.set(camState.target.x, camState.target.y, camState.target.z);
    }
    if (camState.zoom !== undefined) {
      this.camera.zoom = camState.zoom;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  captureSceneState() {
    const state = {
      transforms: {},
      spawned: [], // Track dynamically spawned objects
      cameraViews: this.currentCameraViews || { 'Default': this.captureCameraState() },
      activeCameraView: this.activeCameraView || 'Default'
    };

    // Update the active camera view with current camera position
    state.cameraViews[state.activeCameraView] = this.captureCameraState();

    this.selectableObjects.forEach(obj => {
      state.transforms[obj.name] = {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
      };
      // Track if this was a spawned object (has spawnedType marker)
      if (obj.userData.spawnedType) {
        state.spawned.push({
          name: obj.name,
          type: obj.userData.spawnedType
        });
      }
    });
    return state;
  }

  async applySceneState(state) {
    // Handle old format (just transforms) vs new format (transforms + spawned)
    const transforms = state.transforms || state;
    const spawned = state.spawned || [];

    // First, remove any previously spawned objects that aren't in this scene
    const spawnedNames = spawned.map(s => s.name);
    const toRemove = this.selectableObjects.filter(obj =>
      obj.userData.spawnedType && !spawnedNames.includes(obj.name)
    );
    toRemove.forEach(obj => {
      this.scene.remove(obj);
      const idx = this.selectableObjects.indexOf(obj);
      if (idx > -1) this.selectableObjects.splice(idx, 1);
    });

    // Recreate spawned objects that don't exist yet
    for (const spawnData of spawned) {
      const exists = this.selectableObjects.find(o => o.name === spawnData.name);
      if (!exists && this.buildingPaths[spawnData.type]) {
        const building = await this.loadModel(this.buildingPaths[spawnData.type]);
        if (building) {
          building.userData.spawnedType = spawnData.type;
          this.registerSelectable(building, spawnData.name);
        }
      }
    }

    // Apply transforms
    this.selectableObjects.forEach(obj => {
      const data = transforms[obj.name];
      if (data) {
        obj.position.set(data.position.x, data.position.y, data.position.z);
        obj.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
        obj.scale.set(data.scale.x, data.scale.y, data.scale.z);
      }
    });

    // Handle camera views (new format) or legacy camera (old format)
    if (state.cameraViews) {
      this.currentCameraViews = state.cameraViews;
      this.activeCameraView = state.activeCameraView || Object.keys(state.cameraViews)[0] || 'Default';
      this.applyCameraState(state.cameraViews[this.activeCameraView]);
      this.renderCameraViewList();
    } else if (state.camera) {
      // Legacy format - convert to new format
      this.currentCameraViews = { 'Default': state.camera };
      this.activeCameraView = 'Default';
      this.applyCameraState(state.camera);
      this.renderCameraViewList();
    }
  }

  // Save current camera position as a named view (only when inside a scene)
  saveCameraView(name) {
    // Only allow saving camera views when inside a custom scene
    if (!this.currentSceneName) {
      alert('Please save or load a scene first.\n\nCamera views are saved per-scene.');
      return;
    }

    if (!name) {
      name = prompt('Enter camera view name:', `View ${Object.keys(this.currentCameraViews || {}).length + 1}`);
      if (!name) return;
    }

    if (!this.currentCameraViews) {
      this.currentCameraViews = {};
    }

    this.currentCameraViews[name] = this.captureCameraState();
    this.activeCameraView = name;

    // Auto-save to the current scene
    this.savedScenes[this.currentSceneName] = this.captureSceneState();
    localStorage.setItem('lowpoly_scenes', JSON.stringify(this.savedScenes));

    console.log(`Camera view "${name}" saved to scene "${this.currentSceneName}"`);
    this.renderCameraViewList();
  }

  // Load a named camera view
  loadCameraView(name) {
    if (this.currentCameraViews && this.currentCameraViews[name]) {
      // Save current view before switching
      if (this.activeCameraView && this.currentCameraViews[this.activeCameraView]) {
        this.currentCameraViews[this.activeCameraView] = this.captureCameraState();
      }

      this.activeCameraView = name;
      this.applyCameraState(this.currentCameraViews[name]);
      console.log(`Camera view loaded: ${name}`);
      this.renderCameraViewList();
    }
  }

  // Delete a camera view
  deleteCameraView(name) {
    if (!this.currentSceneName) return;

    if (this.currentCameraViews && this.currentCameraViews[name]) {
      delete this.currentCameraViews[name];

      // If deleted the active view, switch to first available
      if (this.activeCameraView === name) {
        const remaining = Object.keys(this.currentCameraViews);
        this.activeCameraView = remaining[0] || 'Default';
        if (remaining.length === 0) {
          this.currentCameraViews['Default'] = this.captureCameraState();
        }
      }

      // Auto-save to the current scene
      this.savedScenes[this.currentSceneName] = this.captureSceneState();
      localStorage.setItem('lowpoly_scenes', JSON.stringify(this.savedScenes));

      console.log(`Camera view "${name}" deleted from scene "${this.currentSceneName}"`);
      this.renderCameraViewList();
    }
  }

  // Render camera view list in UI
  renderCameraViewList() {
    const container = document.getElementById('camera-views-list');
    const headerEl = document.getElementById('camera-views-header');
    const saveCamBtn = document.getElementById('save-camera-btn');
    if (!container) return;

    // Update header to show current scene
    if (headerEl) {
      if (this.currentSceneName) {
        headerEl.innerHTML = `Camera Views <span style="color:#3498db;">(${this.currentSceneName})</span>`;
      } else {
        headerEl.innerHTML = 'Camera Views <span style="color:#666;">(no scene)</span>';
      }
    }

    // Enable/disable save button based on whether a scene is selected
    if (saveCamBtn) {
      if (this.currentSceneName) {
        saveCamBtn.disabled = false;
        saveCamBtn.style.opacity = '1';
        saveCamBtn.style.cursor = 'pointer';
      } else {
        saveCamBtn.disabled = true;
        saveCamBtn.style.opacity = '0.5';
        saveCamBtn.style.cursor = 'not-allowed';
      }
    }

    // Show message if no scene selected
    if (!this.currentSceneName) {
      container.innerHTML = '<div style="color:#666;font-size:10px;text-align:center;">Load a scene first</div>';
      return;
    }

    const views = Object.keys(this.currentCameraViews || {});

    if (views.length === 0) {
      container.innerHTML = '<div style="color:#666;font-size:10px;text-align:center;">No camera views</div>';
      return;
    }

    container.innerHTML = views.map(name => {
      const isActive = name === this.activeCameraView;
      return `
        <div style="display:flex;align-items:center;margin-bottom:3px;">
          <button class="cam-view-btn" data-view="${name}" style="flex:1;background:${isActive ? '#3498db' : '#444'};color:#fff;border:none;padding:4px 6px;border-radius:3px;cursor:pointer;text-align:left;font-size:10px;">${name}</button>
          <button class="cam-view-delete" data-view="${name}" style="background:#c0392b;color:#fff;border:none;padding:4px 6px;border-radius:3px;cursor:pointer;margin-left:3px;font-size:9px;">X</button>
        </div>
      `;
    }).join('');

    // Add event listeners
    container.querySelectorAll('.cam-view-btn').forEach(btn => {
      btn.addEventListener('click', () => this.loadCameraView(btn.dataset.view));
    });
    container.querySelectorAll('.cam-view-delete').forEach(btn => {
      btn.addEventListener('click', () => this.deleteCameraView(btn.dataset.view));
    });
  }

  saveScene(name) {
    const state = this.captureSceneState();
    this.savedScenes[name] = state;
    this.currentSceneName = name;

    // Persist to localStorage
    localStorage.setItem('lowpoly_scenes', JSON.stringify(this.savedScenes));

    console.log(`Scene saved: ${name}`);
    this.renderSceneList();
  }

  async loadScene(name) {
    const state = this.savedScenes[name];
    if (state) {
      await this.applySceneState(state);
      this.currentSceneName = name;
      console.log(`Scene loaded: ${name}`);
      this.renderSceneList();
      this.renderCameraViewList();  // Update camera views for this scene
    }
  }

  async loadDefaultScene() {
    if (this.defaultSceneState) {
      await this.applySceneState(this.defaultSceneState);
      this.currentSceneName = null;
      // Reset camera views for default scene
      this.currentCameraViews = { 'Default': this.captureCameraState() };
      this.activeCameraView = 'Default';
      console.log('Default scene loaded');
      this.renderSceneList();
      this.renderCameraViewList();  // Update camera views (will show disabled state)
    }
  }

  deleteScene(name) {
    delete this.savedScenes[name];
    localStorage.setItem('lowpoly_scenes', JSON.stringify(this.savedScenes));
    if (this.currentSceneName === name) {
      this.currentSceneName = null;
    }
    console.log(`Scene deleted: ${name}`);
    this.renderSceneList();
  }

  overwriteScene(name) {
    const state = this.captureSceneState();
    this.savedScenes[name] = state;
    this.currentSceneName = name;
    localStorage.setItem('lowpoly_scenes', JSON.stringify(this.savedScenes));
    console.log(`Scene overwritten: ${name}`);
    this.renderSceneList();
  }

  renderSceneList() {
    const container = document.getElementById('saved-scenes-list');
    const scenes = Object.keys(this.savedScenes);

    if (scenes.length === 0) {
      container.innerHTML = '<div style="color:#666;font-size:11px;text-align:center;">No saved scenes</div>';
      return;
    }

    container.innerHTML = scenes.map(name => {
      const isActive = name === this.currentSceneName;
      return `
        <div style="display:flex;align-items:center;margin-bottom:4px;">
          <button class="scene-load-btn" data-scene="${name}" style="flex:1;background:${isActive ? '#74b9ff' : '#555'};color:${isActive ? '#000' : '#fff'};border:none;padding:6px 8px;border-radius:4px;cursor:pointer;text-align:left;font-size:11px;">${name}</button>
          <button class="scene-overwrite-btn" data-scene="${name}" style="background:#f39c12;color:#000;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;margin-left:4px;font-size:10px;" title="Overwrite">S</button>
          <button class="scene-delete-btn" data-scene="${name}" style="background:#e74c3c;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;margin-left:4px;font-size:10px;">X</button>
        </div>
      `;
    }).join('');

    // Add event listeners
    container.querySelectorAll('.scene-load-btn').forEach(btn => {
      btn.addEventListener('click', () => this.loadScene(btn.dataset.scene));
    });
    container.querySelectorAll('.scene-overwrite-btn').forEach(btn => {
      btn.addEventListener('click', () => this.overwriteScene(btn.dataset.scene));
    });
    container.querySelectorAll('.scene-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteScene(btn.dataset.scene));
    });
  }

  // Generate a shareable URL with scene data encoded
  shareScene() {
    const state = this.captureSceneState();
    const json = JSON.stringify(state);
    // Compress using base64
    const encoded = btoa(encodeURIComponent(json));

    // Build URL with current page path
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?scene=${encoded}`;

    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('Share URL copied to clipboard!\n\nPaste this URL to load the scene on any device.');
      console.log('Share URL:', shareUrl);
    }).catch(err => {
      // Fallback: show in prompt
      prompt('Copy this URL to share your scene:', shareUrl);
    });

    return shareUrl;
  }

  // Load scene from URL parameter if present, or load preset on GitHub Pages
  async loadSceneFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const sceneParam = urlParams.get('scene');

    // First try loading from URL parameter
    if (sceneParam) {
      try {
        const json = decodeURIComponent(atob(sceneParam));
        const state = JSON.parse(json);
        await this.applySceneState(state);
        console.log('Scene loaded from URL');

        // Clean URL without reloading page
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

        return true;
      } catch (err) {
        console.error('Failed to load scene from URL:', err);
      }
    }

    // Always load preset scene (both localhost and GitHub Pages)
    try {
      // Try loading all scenes first (includes saved scenes and camera views)
      const scenesPath = getAssetPath('presets/scenes.json');
      console.log('Loading scenes from:', scenesPath);
      const scenesResponse = await fetch(scenesPath);
      const contentType = scenesResponse.headers.get('content-type');

      // Only parse as JSON if it's actually JSON (not HTML fallback)
      if (scenesResponse.ok && contentType && contentType.includes('application/json')) {
        const allData = await scenesResponse.json();

        // Load saved scenes (merge with localStorage on localhost)
        if (allData.savedScenes) {
          // On localhost, merge with existing localStorage scenes
          const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          if (isLocalhost) {
            // Merge: localStorage scenes take priority, but add any from preset that don't exist
            this.savedScenes = { ...allData.savedScenes, ...this.savedScenes };
          } else {
            this.savedScenes = allData.savedScenes;
          }
          this.renderSceneList();
          console.log('Loaded saved scenes:', Object.keys(this.savedScenes));
        }

        // Apply current scene
        if (allData.currentScene) {
          await this.applySceneState(allData.currentScene);
          console.log('Current scene loaded from preset');
          return true;
        }
      }
    } catch (err) {
      console.warn('scenes.json not available:', err.message);
    }

    // Fallback to simple preset (game-scene-1.json)
    try {
      const presetPath = getAssetPath('presets/game-scene-1.json');
      console.log('Loading default preset:', presetPath);
      const response = await fetch(presetPath);
      const contentType = response.headers.get('content-type');

      if (response.ok && contentType && contentType.includes('application/json')) {
        const state = await response.json();
        await this.applySceneState(state);
        this.currentSceneName = 'Game Scene 1';
        this.renderSceneList();
        this.renderCameraViewList();
        console.log('Game Scene 1 loaded as default');
        return true;
      }
    } catch (err) {
      console.error('Failed to load preset scene:', err);
    }

    return false;
  }

  // GitHub integration for pushing scene presets
  getGitHubToken() {
    return localStorage.getItem('github_token');
  }

  setGitHubToken(token) {
    if (token) {
      localStorage.setItem('github_token', token);
    } else {
      localStorage.removeItem('github_token');
    }
  }

  async pushToGitHub() {
    const token = this.getGitHubToken();
    if (!token) {
      const newToken = prompt(
        'Enter your GitHub Personal Access Token:\n\n' +
        'Create one at: https://github.com/settings/tokens/new\n' +
        'Required scope: "repo" (Full control of private repositories)\n\n' +
        'The token will be stored locally in your browser.'
      );
      if (!newToken) {
        alert('GitHub token is required to push changes.');
        return false;
      }
      this.setGitHubToken(newToken);
      return this.pushToGitHub(); // Retry with new token
    }

    const owner = 'creativehubiion';
    const repo = 'hyundai-lowpoly-toon';
    const branch = 'master';

    try {
      // Build complete scenes data
      // Include current scene state and all saved scenes
      const currentState = this.captureSceneState();

      const allData = {
        currentScene: currentState,
        savedScenes: this.savedScenes,
        lastUpdated: new Date().toISOString()
      };

      // Push to scenes.json (all scenes)
      await this.pushFileToGitHub(
        token, owner, repo, branch,
        'assets/presets/scenes.json',
        JSON.stringify(allData, null, 2),
        'Update all scenes data'
      );

      // Also update the default preset (game-scene-1.json) with current scene
      await this.pushFileToGitHub(
        token, owner, repo, branch,
        'assets/presets/game-scene-1.json',
        JSON.stringify(currentState, null, 2),
        'Update default scene preset'
      );

      alert('All scenes pushed to GitHub successfully!\n\nThe site will update after GitHub Pages rebuilds (1-2 minutes).');
      console.log('Scenes pushed to GitHub');
      return true;

    } catch (err) {
      console.error('GitHub push failed:', err);
      if (err.message.includes('401')) {
        this.setGitHubToken(null);
        alert('GitHub token is invalid or expired. Please enter a new one.');
        return this.pushToGitHub();
      }
      alert(`Failed to push to GitHub:\n${err.message}`);
      return false;
    }
  }

  // Helper to push a single file to GitHub
  async pushFileToGitHub(token, owner, repo, branch, path, content, message) {
    const contentBase64 = btoa(unescape(encodeURIComponent(content)));

    // Get current file SHA (required for updates)
    const getFileResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    let sha = null;
    if (getFileResponse.ok) {
      const fileData = await getFileResponse.json();
      sha = fileData.sha;
    }

    // Push the update
    const updateResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `${message}\n\nPushed from Low Poly Toon Viewer`,
          content: contentBase64,
          sha: sha,
          branch: branch
        })
      }
    );

    if (!updateResponse.ok) {
      const error = await updateResponse.json();
      throw new Error(error.message || `Failed to push ${path}`);
    }

    return true;
  }

  // Clear stored GitHub token
  clearGitHubToken() {
    this.setGitHubToken(null);
    alert('GitHub token cleared. You will be prompted for a new token on next push.');
  }

  // Create a single street light pole (procedural geometry)
  spawnStreetLight(x, z, side = 1) {
    const group = new THREE.Group();

    // Pole (dark metal)
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, 3, 8);
    const poleMat = new THREE.MeshToonMaterial({
      color: 0x3a3a3a,
      gradientMap: this.sharedGradientMap
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 1.5;
    pole.castShadow = true;
    group.add(pole);

    // Arm (horizontal extension)
    const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(side * 0.5, 2.8, 0);
    arm.castShadow = true;
    group.add(arm);

    // Lamp head (box)
    const lampGeo = new THREE.BoxGeometry(0.3, 0.15, 0.5);
    const lampMat = new THREE.MeshToonMaterial({
      color: 0x555555,
      gradientMap: this.sharedGradientMap
    });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(side * 1.0, 2.7, 0);
    lamp.castShadow = true;
    group.add(lamp);

    // Glowing light surface (emissive)
    const glowGeo = new THREE.PlaneGeometry(0.25, 0.4);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
      side: THREE.DoubleSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(side * 1.0, 2.6, 0);
    group.add(glow);

    // Add outline to pole
    const poleOutline = this.createOutline(pole, 0.02);
    pole.add(poleOutline);

    group.position.set(x, 0, z);
    this.scene.add(group);

    return group;
  }

  // Spawn street lights along both sides of the road
  spawnStreetLights(roadLength, spacing = 10) {
    console.log(`Spawning street lights every ${spacing} units...`);
    const roadOffset = 3;  // Distance from road center

    for (let z = 5; z < roadLength * 0.5; z += spacing) {
      // Left side
      this.spawnStreetLight(-roadOffset, z, -1);
      // Right side
      this.spawnStreetLight(roadOffset, z, 1);
    }

    console.log('Street lights spawned');
  }

  // Spawn utility poles with sagging cables along the road
  spawnUtilityPoles() {
    if (!this.utilityPoles) this.utilityPoles = [];

    // Clear existing
    this.utilityPoles.forEach(p => this.scene.remove(p));
    this.utilityPoles = [];

    const poleSpacing = 20;  // Every 20 units
    const roadLength = 80;   // Approximate road length
    const sideOffset = 3.5;  // Distance from road center

    // Create poles along one side of the road
    const polePositions = [];
    for (let z = 0; z > -roadLength; z -= poleSpacing) {
      polePositions.push({ x: sideOffset, z: z });
    }

    // Spawn each pole
    polePositions.forEach((pos, i) => {
      const pole = this.createUtilityPole(pos.x, pos.z);
      this.utilityPoles.push(pole);

      // Connect cables to next pole
      if (i < polePositions.length - 1) {
        const nextPos = polePositions[i + 1];
        this.createSaggingCables(pos.x, pos.z, nextPos.x, nextPos.z);
      }
    });

    console.log(`Spawned ${this.utilityPoles.length} utility poles with cables`);
  }

  // Create a single utility pole
  createUtilityPole(x, z) {
    const group = new THREE.Group();

    // Main pole - tall wooden/concrete cylinder
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 8, 8);
    const poleMat = new THREE.MeshToonMaterial({
      color: 0x4a3c2a,  // Dark wood brown
      gradientMap: this.sharedGradientMap
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 4;  // Half height
    pole.castShadow = true;
    pole.receiveShadow = true;
    group.add(pole);

    // Crossarm at top
    const armGeo = new THREE.BoxGeometry(2.0, 0.1, 0.1);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.y = 7.5;
    group.add(arm);

    // Small insulators on crossarm (where cables attach)
    const insulatorGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.15, 6);
    const insulatorMat = new THREE.MeshToonMaterial({
      color: 0x333333,
      gradientMap: this.sharedGradientMap
    });
    [-0.7, 0, 0.7].forEach(offset => {
      const insulator = new THREE.Mesh(insulatorGeo, insulatorMat);
      insulator.position.set(offset, 7.6, 0);
      group.add(insulator);
    });

    // Add outline to pole
    const poleOutline = this.createOutline(pole, 0.015);
    pole.add(poleOutline);

    group.position.set(x, 0, z);
    this.scene.add(group);

    return group;
  }

  // Create 3 sagging cables between two poles using catenary curve
  createSaggingCables(x1, z1, x2, z2) {
    const cableMat = new THREE.LineBasicMaterial({
      color: 0x000000  // Pure black for clear silhouettes against sky
    });

    const cableHeight = 7.6;           // Height at crossarm
    const cableOffsets = [-0.7, 0, 0.7];  // 3 wires matching insulator positions
    const sagAmount = 1.2;             // Catenary sag depth

    cableOffsets.forEach((offset) => {
      const points = [];
      const segments = 24;  // Smooth curve

      for (let j = 0; j <= segments; j++) {
        const t = j / segments;

        // Interpolate position along cable path
        const x = x1 + offset;  // X stays constant (wires run parallel to road)
        const z = z1 + (z2 - z1) * t;

        // Catenary-like sag using parabolic approximation
        // Deepest at t=0.5 (middle of span)
        const sag = sagAmount * 4 * t * (1 - t);  // Parabola: 0 at ends, max at middle
        const y = cableHeight - sag;

        points.push(new THREE.Vector3(x, y, z));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const cable = new THREE.Line(geometry, cableMat);
      this.scene.add(cable);
      this.utilityPoles.push(cable);  // Track for cleanup
    });
  }

  // Create procedural alpha map texture for soft, organic puddle edges
  createPuddleAlphaMap(seed = 0) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Seeded random for consistent shapes
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // Start with black (transparent)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    // Create organic blob using multiple overlapping radial gradients
    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = size * 0.35;

    // Draw main blob with irregular edges using multiple offset circles
    const numBlobs = 5 + Math.floor(seededRandom() * 4);
    for (let i = 0; i < numBlobs; i++) {
      const angle = (i / numBlobs) * Math.PI * 2 + seededRandom() * 0.5;
      const offsetDist = seededRandom() * baseRadius * 0.3;
      const blobX = centerX + Math.cos(angle) * offsetDist;
      const blobY = centerY + Math.sin(angle) * offsetDist;
      const blobRadius = baseRadius * (0.6 + seededRandom() * 0.5);

      // Radial gradient for soft edges
      const gradient = ctx.createRadialGradient(blobX, blobY, 0, blobX, blobY, blobRadius);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.75, 'rgba(255,255,255,0.5)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(blobX, blobY, blobRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add some smaller satellite blobs for more organic feel
    const numSatellites = 2 + Math.floor(seededRandom() * 3);
    for (let i = 0; i < numSatellites; i++) {
      const angle = seededRandom() * Math.PI * 2;
      const dist = baseRadius * (0.7 + seededRandom() * 0.4);
      const satX = centerX + Math.cos(angle) * dist;
      const satY = centerY + Math.sin(angle) * dist;
      const satRadius = baseRadius * (0.2 + seededRandom() * 0.25);

      const gradient = ctx.createRadialGradient(satX, satY, 0, satX, satY, satRadius);
      gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
      gradient.addColorStop(0.6, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(satX, satY, satRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  // Create procedural normal map for wavy water surface
  createWaterNormalMap() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Create normal map data (RGB encodes normal direction)
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Generate subtle wave pattern using sine waves
        const wave1 = Math.sin(x * 0.15) * Math.cos(y * 0.12) * 0.3;
        const wave2 = Math.sin(x * 0.08 + y * 0.1) * 0.2;
        const wave3 = Math.sin(x * 0.2 - y * 0.15) * 0.15;
        const combined = wave1 + wave2 + wave3;

        // Normal map: R=X, G=Y, B=Z (pointing up)
        // Flat surface normal is (0.5, 0.5, 1.0) in 0-255 range = (128, 128, 255)
        const nx = 128 + combined * 40;  // Subtle X displacement
        const ny = 128 + combined * 40;  // Subtle Y displacement
        const nz = 255;                   // Z always pointing up

        data[idx] = Math.max(0, Math.min(255, nx));
        data[idx + 1] = Math.max(0, Math.min(255, ny));
        data[idx + 2] = nz;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  // Setup CubeCamera for static puddle reflections (one-time capture)
  setupPuddleCubeCamera() {
    // Skip CubeCamera on mobile devices (causes crashes on iOS)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      console.log('Mobile detected - skipping CubeCamera for performance');
      this.puddleCubeCamera = null;
      this.waterNormalMap = this.createWaterNormalMap();
      this.puddleReflectionCaptured = true;  // Skip capture
      return null;
    }

    try {
      // Create render target for cube camera (256x256 for performance)
      const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
        format: THREE.RGBAFormat,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter
      });

      // Create cube camera positioned at average puddle height
      this.puddleCubeCamera = new THREE.CubeCamera(0.1, 150, cubeRenderTarget);
      this.puddleCubeCamera.position.set(0, 0.5, -25); // Near the car area, slightly elevated
      this.scene.add(this.puddleCubeCamera);

      // Create shared normal map for water distortion
      this.waterNormalMap = this.createWaterNormalMap();

      // Flag for static capture (buildings don't move, so capture once)
      this.puddleReflectionCaptured = false;

      console.log('Puddle CubeCamera ready (static mode)');
      return cubeRenderTarget.texture;
    } catch (error) {
      console.warn('CubeCamera failed, using skybox fallback:', error);
      this.puddleCubeCamera = null;
      this.waterNormalMap = this.createWaterNormalMap();
      this.puddleReflectionCaptured = true;
      return null;
    }
  }

  // Setup CubeCamera for road reflections (single snapshot, not real-time)
  setupRoadReflectionCamera() {
    try {
      // Resolution Cap: 256x256 for performance
      const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
        format: THREE.RGBAFormat,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter
      });

      this.roadCubeCamera = new THREE.CubeCamera(0.1, 200, cubeRenderTarget);
      this.roadCubeCamera.position.set(0, 0.3, -25); // Low position for road perspective
      this.scene.add(this.roadCubeCamera);

      // Flag for single snapshot capture
      this.roadReflectionCaptured = false;

      console.log('Road reflection CubeCamera ready (256x256, single snapshot)');
      return cubeRenderTarget.texture;
    } catch (error) {
      console.warn('Road CubeCamera failed:', error);
      this.roadCubeCamera = null;
      return null;
    }
  }

  // Capture road reflections once (called after scene loads)
  captureRoadReflections() {
    if (!this.roadCubeCamera || this.roadReflectionCaptured) return;

    console.log('Capturing road building reflections (single snapshot)...');

    // Hide roads during capture
    if (this.roadMeshes) {
      this.roadMeshes.forEach(mesh => mesh.visible = false);
    }

    // Capture buildings reflection
    this.roadCubeCamera.update(this.renderer, this.scene);

    // Restore road visibility
    if (this.roadMeshes) {
      this.roadMeshes.forEach(mesh => mesh.visible = true);
    }

    this.roadReflectionCaptured = true;
    console.log('Road reflections captured (no further updates)');
  }

  // Capture static puddle reflections (call once after scene loads)
  captureStaticPuddleReflections() {
    if (!this.puddleCubeCamera || this.puddleReflectionCaptured) return;

    console.log('Capturing static puddle reflections...');
    console.log('  Buildings visible:', this.selectableObjects.length);

    // Hide ground-level objects during capture (keeps buildings + sky)
    if (this.puddles) this.puddles.forEach(p => p.visible = false);
    if (this.groundTiles) this.groundTiles.forEach(t => t.visible = false);
    if (this.roadPieces) this.roadPieces.forEach(r => r.visible = false);
    if (this.gridHelper) this.gridHelper.visible = false;
    if (this.streetLights) this.streetLights.forEach(l => l.visible = false);

    // Ensure all buildings (selectableObjects) are visible
    this.selectableObjects.forEach(obj => obj.visible = true);

    // Position cube camera near the main action area
    this.puddleCubeCamera.position.set(0, 0.3, -20);

    // Render cube map (one-time capture)
    this.puddleCubeCamera.update(this.renderer, this.scene);

    // Restore visibility (except grid helper which stays hidden by default)
    if (this.puddles) this.puddles.forEach(p => p.visible = true);
    if (this.groundTiles) this.groundTiles.forEach(t => t.visible = true);
    if (this.roadPieces) this.roadPieces.forEach(r => r.visible = true);
    // gridHelper stays hidden - user can toggle with G key
    if (this.streetLights) this.streetLights.forEach(l => l.visible = true);

    // Mark as captured - no more updates needed
    this.puddleReflectionCaptured = true;
    console.log('Static puddle reflections captured (no further updates)');
  }

  // Spawn a single reflective puddle with alpha map for soft edges
  spawnPuddle(x, z, scale = 1, rotationY = 0) {
    // Use a plane geometry - shape controlled by alpha map
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2); // Lie flat

    // Create unique alpha map for this puddle
    const alphaMap = this.createPuddleAlphaMap(Math.random() * 10000);

    // Use CubeCamera reflection if available, fallback to skybox
    const envMap = this.puddleCubeCamera
      ? this.puddleCubeCamera.renderTarget.texture
      : this.skyboxCubemap;

    // High-reflectivity material with real-time reflections
    // Multiply blending makes puddles "wet" the road beneath
    const material = new THREE.MeshStandardMaterial({
      color: 0x222222,           // Darker than road for contrast
      envMap: envMap,
      envMapIntensity: 4.0,      // Boosted for vivid reflections
      roughness: 0,              // Perfect mirror for still water
      metalness: 1.0,            // Full metallic for maximum reflection
      normalMap: this.waterNormalMap,
      normalScale: new THREE.Vector2(0.07, 0.07),  // Subtle ripples - calm but visible
      transparent: true,
      opacity: 0.4,              // See road markings through water
      alphaMap: alphaMap,        // Soft organic edges
      side: THREE.DoubleSide,
      depthWrite: false          // Helps with transparency sorting
    });

    const puddle = new THREE.Mesh(geometry, material);

    // Position just above road surface to avoid z-fighting
    puddle.position.set(x, 0.02, z);
    puddle.rotation.y = rotationY;
    puddle.scale.set(scale, 1, scale);

    // Shadows: receive but don't cast
    puddle.castShadow = false;
    puddle.receiveShadow = true;

    // Ensure it renders after the road
    puddle.renderOrder = 1;

    // Mark as puddle (non-selectable)
    puddle.userData.isPuddle = true;

    this.scene.add(puddle);

    // Track puddles for potential cleanup
    if (!this.puddles) this.puddles = [];
    this.puddles.push(puddle);

    return puddle;
  }

  // Spawn multiple puddles around the scene
  spawnPuddles() {
    console.log('Spawning puddles... skyboxCubemap:', this.skyboxCubemap ? 'exists' : 'null');

    // Clear existing puddles
    if (this.puddles) {
      this.puddles.forEach(p => this.scene.remove(p));
      this.puddles = [];
    }

    // Puddle locations - near the car and along road in Game Scene 1
    const puddleConfigs = [
      // Near the car (z ~ -18)
      { x: -0.5, z: -17, scale: 1.2, rot: Math.random() * Math.PI },
      { x: 0.8, z: -19, scale: 0.8, rot: Math.random() * Math.PI },
      { x: -1.2, z: -20, scale: 1.0, rot: Math.random() * Math.PI },

      // Along the road spine
      { x: 0.3, z: -23, scale: 0.7, rot: Math.random() * Math.PI },
      { x: -0.8, z: -26, scale: 0.9, rot: Math.random() * Math.PI },
      { x: 0.5, z: -30, scale: 1.1, rot: Math.random() * Math.PI },

      // Near intersections
      { x: 1.5, z: -33, scale: 0.6, rot: Math.random() * Math.PI },
      { x: -1.0, z: -38, scale: 0.8, rot: Math.random() * Math.PI },
    ];

    puddleConfigs.forEach(config => {
      const puddle = this.spawnPuddle(config.x, config.z, config.scale, config.rot);
      console.log(`Puddle at (${config.x}, ${config.z}), scale: ${config.scale}`);
    });

    console.log(`Spawned ${this.puddles.length} puddles`);
  }

  // Boost texture contrast (for road stripes visibility)
  boostTextureContrast(texture, contrast = 1.5) {
    if (!texture || !texture.image) return null;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = texture.image.width || 512;
      canvas.height = texture.image.height || 512;

      // Draw original texture
      ctx.drawImage(texture.image, 0, 0, canvas.width, canvas.height);

      // Get image data and boost contrast
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        // Apply contrast: (color - 128) * contrast + 128
        data[i] = Math.max(0, Math.min(255, (data[i] - 128) * contrast + 128));
        data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - 128) * contrast + 128));
        data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - 128) * contrast + 128));
      }

      ctx.putImageData(imageData, 0, 0);

      const newTexture = new THREE.CanvasTexture(canvas);
      newTexture.wrapS = texture.wrapS;
      newTexture.wrapT = texture.wrapT;
      newTexture.repeat.copy(texture.repeat);
      newTexture.colorSpace = THREE.SRGBColorSpace;
      console.log('Road texture contrast boosted by', contrast);
      return newTexture;
    } catch (e) {
      console.warn('Could not boost texture contrast:', e);
      return null;
    }
  }

  // Create procedural noise bump map for road "crunchy" texture
  createRoadBumpMap() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Start with medium gray (neutral bump)
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    // Add multi-scale noise for realistic asphalt texture
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;

        // Fine grain noise (small pebbles)
        const fineNoise = (Math.random() - 0.5) * 60;

        // Medium noise (aggregate texture)
        const medNoise = (Math.sin(x * 0.3) * Math.cos(y * 0.3) + Math.random() - 0.5) * 30;

        // Coarse noise (larger surface variation)
        const coarseNoise = (Math.sin(x * 0.05 + Math.random()) * Math.cos(y * 0.05)) * 20;

        const totalNoise = fineNoise + medNoise + coarseNoise;
        const value = Math.max(0, Math.min(255, 128 + totalNoise));

        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Add some random darker pits (tar patches, worn spots)
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 8 + 2;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, 'rgba(40,40,40,0.5)');
      gradient.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Add some lighter bumps (pebbles sticking up)
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 3 + 1;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, 'rgba(200,200,200,0.6)');
      gradient.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 4);  // Large organic patches, not tight grid
    return texture;
  }

  // Create procedural noise texture for road
  createAsphaltTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Dark charcoal base for damp wet asphalt look
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, size, size);

    // Add very subtle noise
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 10;  // Minimal noise
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    // Add some subtle darker spots
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 5 + 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`;
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  setupHelpers() {
    this.gridHelper = new THREE.GridHelper(50, 50, 0xffffff, 0xffffff);
    this.gridHelper.material.opacity = 0.15;
    this.gridHelper.material.transparent = true;
    this.gridHelper.visible = false;  // Hidden by default
    this.scene.add(this.gridHelper);

    // Axes helper (hidden by default)
    this.axesHelper = new THREE.AxesHelper(5);
    this.axesHelper.visible = false;
    this.scene.add(this.axesHelper);
  }
  // Get grid key for world position
  getGridKey(worldX, worldZ) {
    const gridX = Math.round(worldX / this.TILE_SIZE);
    const gridZ = Math.round(worldZ / this.TILE_SIZE);
    return `${gridX},${gridZ}`;
  }

  // Snap world position to grid
  snapToGrid(pos) {
    return Math.round(pos / this.TILE_SIZE) * this.TILE_SIZE;
  }

  // Check if grid cell is occupied
  isGridOccupied(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    return this.worldGrid.has(key);
  }

  // Remove tile at grid position
  removeTileAt(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    const entry = this.worldGrid.get(key);
    if (entry) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      this.worldGrid.delete(key);

      // Remove from groundTiles array if it's a grass tile
      const idx = this.groundTiles.indexOf(entry.mesh);
      if (idx > -1) this.groundTiles.splice(idx, 1);

      return true;
    }
    return false;
  }

  // Spawn a single grass tile at grid position (x, z)
  spawnGrassTile(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;

    // Check if already occupied
    if (this.worldGrid.has(key)) {
      return null;  // Abort - tile exists
    }

    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }

    const geometry = new THREE.PlaneGeometry(this.TILE_SIZE, this.TILE_SIZE);
    const material = new THREE.MeshToonMaterial({
      color: 0x78ab46,  // Natural anime green
      gradientMap: this.sharedGradientMap,
      side: THREE.DoubleSide
    });
    // Subtle emissive for sky glow without being neon
    material.emissive = new THREE.Color(0x1a2e1a);
    material.emissiveIntensity = 1.0;

    const tile = new THREE.Mesh(geometry, material);
    tile.rotation.x = -Math.PI / 2;  // Lay flat
    tile.position.set(
      gridX * this.TILE_SIZE,
      -0.01,  // Grass sits slightly below to avoid z-fighting
      gridZ * this.TILE_SIZE
    );

    // Ground receives shadows but doesn't cast them
    tile.receiveShadow = true;
    tile.castShadow = false;

    // No outlines for ground tiles - keep horizon clean
    this.scene.add(tile);
    this.groundTiles.push(tile);

    // Register in world grid
    this.worldGrid.set(key, { type: 'grass', mesh: tile });

    return tile;
  }

  // Generate a grid of ground tiles
  generateGroundGrid(gridSize = 20) {
    console.log(`Generating ${gridSize}x${gridSize} ground grid...`);

    // Clear existing tiles and world grid
    this.groundTiles.forEach(tile => {
      this.scene.remove(tile);
      tile.geometry.dispose();
      tile.material.dispose();
    });
    this.groundTiles = [];
    this.worldGrid.clear();

    // Generate centered grid
    const halfGrid = Math.floor(gridSize / 2);
    for (let x = -halfGrid; x < halfGrid; x++) {
      for (let z = -halfGrid; z < halfGrid; z++) {
        this.spawnGrassTile(x, z);
      }
    }

    console.log(`Generated ${this.groundTiles.length} ground tiles`);
  }

  loadHDR(path) {
    return new Promise((resolve, reject) => {
      this.rgbeLoader.load(path, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        resolve(texture);
      }, undefined, reject);
    });
  }

  // Load stylized cubemap skybox
  loadSkybox(basePath, ext = 'webp') {
    return new Promise((resolve, reject) => {
      const loader = new THREE.CubeTextureLoader();
      loader.setPath(basePath);

      const files = [`px.${ext}`, `nx.${ext}`, `py.${ext}`, `ny.${ext}`, `pz.${ext}`, `nz.${ext}`];

      loader.load(
        files,
        (cubemap) => {
          console.log('Skybox cubemap loaded:', ext);
          resolve(cubemap);
        },
        undefined,
        (error) => {
          console.error('Failed to load skybox:', error);
          reject(error);
        }
      );
    });
  }

  createToonGradientMap() {
    // Vibrant saturated gradient for deep colors
    const colors = new Uint8Array([
      100, 110, 160, 255,  // Pixel 1: Deep saturated periwinkle/navy shadow
      200, 210, 230, 255,  // Pixel 2: Midtone
      255, 255, 255, 255   // Pixel 3: Highlight
    ]);
    const gradientMap = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
    gradientMap.needsUpdate = true;

    // CRITICAL: NearestFilter keeps sharp cell transitions
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;

    return gradientMap;
  }

  // Road-specific gradient (nearly black for wet rain look)
  createRoadGradientMap() {
    const colors = new Uint8Array([
      5, 5, 8, 255,        // Pixel 1: Nearly black shadow (#050508)
      10, 10, 15, 255,     // Pixel 2: Very dark (#0a0a0f)
      20, 20, 28, 255      // Pixel 3: Slightly lighter (#14141c)
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

      // Debug: log if no meshes found
      if (meshes.length === 0) {
        console.warn(`  WARNING: No meshes found in model! Logging all nodes:`);
        model.traverse((node) => {
          console.log(`    Node: ${node.name || '(unnamed)'} type=${node.type}`);
        });
      }

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
        toonMat.emissiveIntensity = 0.15;

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

        // Buildings cast shadows
        node.castShadow = true;
        node.receiveShadow = true;

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
          // Windows: Reflective glass with skybox cubemap
          toonMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,  // Dark navy base
            metalness: 0.9,
            roughness: 0.1,
            side: THREE.DoubleSide
          });
          // Apply skybox cubemap for anime cloud reflections
          if (this.skyboxCubemap) {
            toonMat.envMap = this.skyboxCubemap;
            toonMat.envMapIntensity = 2.0;
          }
          toonMat.emissive = new THREE.Color(0x0a0a1a);
          toonMat.emissiveIntensity = 0.15;
          console.log(`    -> Window material with reflections: ${node.name}`);
        } else if (isBody) {
          // Car body: light gray to avoid triggering bloom
          toonMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0,       // Light gray - won't trigger bloom
            metalness: 0.3,
            roughness: 0.4,
            side: THREE.DoubleSide
          });
          // Subtle reflections only
          if (this.skyboxCubemap) {
            toonMat.envMap = this.skyboxCubemap;
            toonMat.envMapIntensity = 0.5;  // Lowered to avoid bloom
          }
          // Preserve texture map for paint details
          if (origMat.map) {
            toonMat.map = origMat.map;
            console.log(`    -> Body with texture preserved: ${node.name}`);
          } else {
            console.log(`    -> Body (no texture): ${node.name}`);
          }
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
          toonMat.emissiveIntensity = 0.15;
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
          toonMat.emissiveIntensity = 0.15;
        }

        // Enable vertex colors if present
        if (node.geometry.attributes.color) {
          toonMat.vertexColors = true;
        }

        node.material = toonMat;

        // Car casts shadows but doesn't receive them
        node.castShadow = true;
        node.receiveShadow = false;

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
        '/Road%20Pack/Textures%20compressed/Normal+AO/initialShadingGroup_Base_Color.png',
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
        '/Road%20Pack/Textures%20compressed/Normal+AO/initialShadingGroup_Base_Color.png',
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

      // Apply toon material with texture
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

        // Roads receive shadows but don't cast them
        node.receiveShadow = true;
        node.castShadow = false;

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
      const name = child.name.toLowerCase();
      if (name.includes('socket_out') || (name.includes('socket') && !name.includes('socket_in'))) {
        socket = child;
      }
    });
    return socket;
  }

  // Find socket_in (start point) in a model
  findSocketIn(model) {
    let socket = null;
    model.traverse((child) => {
      const name = child.name.toLowerCase();
      if (name.includes('socket_in') || name.includes('origin') || name.includes('start')) {
        socket = child;
      }
    });
    return socket;
  }

  // SYSTEM 3: Main Road with Side Streets
  // Road1 = straight piece, RoadX = 4-way intersection
  // Origin of each piece acts as socket_in (no explicit socket_in empty)
  // Socket snapping: snap piece origin to world position of previous piece's target socket
  async spawnSpineAndBranchSystem3() {
    console.log('[System 3] Main Road with Side Streets...');

    // Clear existing
    this.roadPieces.forEach(p => this.scene.remove(p));
    this.roadPieces = [];

    // Seeded PRNG for deterministic road generation (mulberry32)
    const SEED = 12345;
    let seedState = SEED;
    const seededRandom = () => {
      seedState |= 0;
      seedState = seedState + 0x6D2B79F5 | 0;
      let t = Math.imul(seedState ^ seedState >>> 15, 1 | seedState);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };

    // Load templates
    const templates = {};
    const roadPaths = {
      'Road1': getAssetPath('Low%20Poly%20Env%20Exports/Road1a.glb'),
      'RoadX': getAssetPath('Low%20Poly%20Env%20Exports/RoadXa.glb')
    };

    for (const [name, path] of Object.entries(roadPaths)) {
      try {
        const gltf = await new Promise((resolve, reject) => {
          this.gltfLoader.load(path, resolve, undefined, reject);
        });

        const template = gltf.scene;
        const meshes = [];
        template.traverse((node) => {
          if (node.isMesh) meshes.push(node);
        });

        // Use road reflection camera if available, fallback to skybox
        const roadEnvMap = this.roadCubeCamera
          ? this.roadCubeCamera.renderTarget.texture
          : this.skyboxCubemap;

        meshes.forEach((node) => {
          const origMat = node.material;

          // Road material - wetness disabled for now
          // const wetRoadMat = new THREE.MeshStandardMaterial({
          //   color: 0xffffff, roughness: 0.1, metalness: 0.38,
          //   side: THREE.DoubleSide, envMap: roadEnvMap, envMapIntensity: 1.9
          // });
          const wetRoadMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,           // White - texture shows at full color
            roughness: 0.8,            // Dry road
            metalness: 0.0,            // No metalness
            side: THREE.DoubleSide
          });

          // Preserve original texture map from GLB
          if (origMat.map) {
            wetRoadMat.map = origMat.map;
            // Max anisotropic filtering for sharp road textures
            wetRoadMat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            console.log(`Road texture: ${origMat.map.image?.width}x${origMat.map.image?.height}, anisotropy: ${wetRoadMat.map.anisotropy}`);
          }

          node.geometry.computeVertexNormals();
          node.material = wetRoadMat;
          node.receiveShadow = true;
          node.castShadow = false;

          // Put roads on layer 1 so reflection camera can ignore them
          node.layers.set(1);
          // Also enable layer 0 so main camera can see them
          node.layers.enable(0);

          // Track road meshes for reflection updates
          if (!this.roadMeshes) this.roadMeshes = [];
          this.roadMeshes.push(node);

          const outline = this.createOutline(node, 0.03);
          node.add(outline);
        });

        // Log sockets found in template
        console.log(`  ${name} sockets:`);
        template.traverse((child) => {
          if (child.name.toLowerCase().includes('socket')) {
            console.log(`    - ${child.name} at local (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
          }
        });

        template.visible = false;
        this.scene.add(template);
        templates[name] = template;
        console.log(`  Loaded: ${name}`);
      } catch (error) {
        console.error(`Failed to load ${name}:`, error);
      }
    }

    // Helper: find socket by exact name (case insensitive)
    const findSocket = (model, socketName) => {
      let socket = null;
      model.traverse((child) => {
        if (child.name.toLowerCase() === socketName.toLowerCase()) {
          socket = child;
        }
      });
      // Fallback: partial match
      if (!socket) {
        model.traverse((child) => {
          if (child.name.toLowerCase().includes(socketName.toLowerCase())) {
            socket = child;
          }
        });
      }
      return socket;
    };

    // Helper: clone and place a road piece
    // Snaps piece origin to targetPos with targetQuat
    const spawnPiece = (pieceType, targetPos, targetQuat) => {
      const template = templates[pieceType];
      if (!template) return null;

      const piece = template.clone(true);
      piece.visible = true;
      piece.traverse((child) => { child.visible = true; });

      // SOCKET SNAPPING: Snap origin to target position/rotation
      piece.position.copy(targetPos);
      piece.quaternion.copy(targetQuat);

      this.scene.add(piece);
      piece.updateMatrixWorld(true);
      this.roadPieces.push(piece);

      return piece;
    };

    // Helper: get socket world transform
    const getSocketTransform = (piece, socketName) => {
      const socket = findSocket(piece, socketName);
      if (!socket) return null;

      socket.updateMatrixWorld(true);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      socket.getWorldPosition(pos);
      socket.getWorldQuaternion(quat);
      return { pos, quat };
    };

    // Pending branches to spawn after main spine
    const branches = [];

    // ====== MAIN SPINE LOOP ======
    // 20 iterations, 20% chance to spawn RoadX instead of Road1
    const SPINE_LENGTH = 20;
    const ROADX_CHANCE = 0.2; // 20% chance for intersection

    let currentPos = new THREE.Vector3(0, 0, 0);
    let currentQuat = new THREE.Quaternion(); // Identity = facing +Z

    console.log(`  Building main spine (${SPINE_LENGTH} pieces)...`);

    for (let i = 0; i < SPINE_LENGTH; i++) {
      // Decide piece type: seeded 20% chance for RoadX (not on first or last piece)
      const useRoadX = (i > 0 && i < SPINE_LENGTH - 1) && seededRandom() < ROADX_CHANCE;
      const pieceType = useRoadX ? 'RoadX' : 'Road1';

      // Spawn piece at current position
      const piece = spawnPiece(pieceType, currentPos, currentQuat);
      if (!piece) {
        console.error(`  Failed to spawn ${pieceType} at piece ${i}`);
        break;
      }

      console.log(`  Spine[${i}]: ${pieceType} at (${currentPos.x.toFixed(1)}, ${currentPos.z.toFixed(1)})`);

      // If RoadX, queue side street branches from socket_left and socket_right
      if (useRoadX) {
        const leftTransform = getSocketTransform(piece, 'socket_left');
        const rightTransform = getSocketTransform(piece, 'socket_right');

        if (leftTransform) {
          branches.push({ ...leftTransform, side: 'left', length: 5 });
          console.log(`    -> Queued left branch`);
        }
        if (rightTransform) {
          branches.push({ ...rightTransform, side: 'right', length: 5 });
          console.log(`    -> Queued right branch`);
        }
      }

      // Get socket_out for next piece
      const nextTransform = getSocketTransform(piece, 'socket_out');
      if (nextTransform) {
        currentPos = nextTransform.pos;
        currentQuat = nextTransform.quat;
      } else {
        console.warn(`  No socket_out on ${pieceType}, stopping spine`);
        break;
      }
    }

    console.log(`  Main spine complete: ${this.roadPieces.length} pieces`);

    // ====== BRANCH LOOPS ======
    // For each queued branch, spawn 5 straight pieces
    console.log(`  Spawning ${branches.length} side streets...`);

    for (const branch of branches) {
      let branchPos = branch.pos.clone();
      let branchQuat = branch.quat.clone();

      console.log(`  Branch (${branch.side}): starting at (${branchPos.x.toFixed(1)}, ${branchPos.z.toFixed(1)})`);

      for (let j = 0; j < branch.length; j++) {
        const piece = spawnPiece('Road1', branchPos, branchQuat);
        if (!piece) break;

        // Get socket_out for next piece in branch
        const nextTransform = getSocketTransform(piece, 'socket_out');
        if (nextTransform) {
          branchPos = nextTransform.pos;
          branchQuat = nextTransform.quat;
        } else {
          break;
        }
      }
    }

    console.log(`[System 3] Complete: ${this.roadPieces.length} total pieces, ${branches.length} side streets`);
  }

  // SYSTEM 2: Road network using Road1 and RoadX (intersection piece)
  // RoadX has socket_out, socket_right, socket_left for branching
  async spawnRoadNetworkSystem2(count = 30) {
    console.log(`[System 2] Generating road network with ${count} pieces...`);

    // Clear existing
    this.roadPieces.forEach(p => this.scene.remove(p));
    this.roadPieces = [];
    this.occupiedCells.clear();

    const templates = {};

    // Load Road1 and RoadX
    const roadPaths = {
      'Road1': getAssetPath('Low%20Poly%20Env%20Exports/Road1a.glb'),
      'RoadX': getAssetPath('Low%20Poly%20Env%20Exports/RoadXa.glb')
    };

    for (const [name, path] of Object.entries(roadPaths)) {
      try {
        const gltf = await new Promise((resolve, reject) => {
          this.gltfLoader.load(path, resolve, undefined, reject);
        });

        const template = gltf.scene;

        // Collect meshes first
        const meshes = [];
        template.traverse((node) => {
          if (node.isMesh) meshes.push(node);
        });

        // Apply toon material
        meshes.forEach((node) => {
          const toonMat = new THREE.MeshToonMaterial({
            gradientMap: this.sharedGradientMap,
            side: THREE.DoubleSide
          });
          if (node.material.color) {
            toonMat.color.copy(node.material.color);
          }
          toonMat.emissive.set(0x222222);
          toonMat.emissiveIntensity = 0.1;
          node.geometry.computeVertexNormals();
          node.material = toonMat;
          node.receiveShadow = true;
          node.castShadow = false;

          const outline = this.createOutline(node, 0.03);
          node.add(outline);
        });

        // Log sockets found
        console.log(`  ${name} sockets:`);
        template.traverse((child) => {
          if (child.name.toLowerCase().includes('socket')) {
            console.log(`    - ${child.name} at (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
          }
        });

        template.visible = false;
        this.scene.add(template);
        templates[name] = template;
        console.log(`  Loaded: ${name}`);
      } catch (error) {
        console.error(`Failed to load ${name}:`, error);
      }
    }

    // Find all sockets in a piece
    const findAllSockets = (model) => {
      const sockets = [];
      model.traverse((child) => {
        const name = child.name.toLowerCase();
        if (name.includes('socket_out')) {
          sockets.push({ node: child, type: 'out' });
        } else if (name.includes('socket_right')) {
          sockets.push({ node: child, type: 'right' });
        } else if (name.includes('socket_left')) {
          sockets.push({ node: child, type: 'left' });
        } else if (name.includes('socket') && !name.includes('in')) {
          sockets.push({ node: child, type: 'out' });
        }
      });
      return sockets;
    };

    // Queue of open sockets to connect to
    const openSockets = [];

    // Sample centerline for collision
    const sampleCenterline = (piece) => {
      const samples = [];
      const origin = new THREE.Vector3();
      piece.getWorldPosition(origin);
      samples.push({ x: origin.x, z: origin.z });

      const sockets = findAllSockets(piece);
      for (const { node } of sockets) {
        const socketWorld = new THREE.Vector3();
        node.getWorldPosition(socketWorld);

        // Sample between origin and socket
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const point = origin.clone().lerp(socketWorld, t);
          samples.push({ x: point.x, z: point.z });
        }
      }
      return samples;
    };

    // Check collision
    const checkCollision = (samples, tolerance = 2) => {
      for (const s of samples) {
        const key = this.cellKey(s.x, s.z);
        if (this.occupiedCells.has(key)) {
          return true;
        }
      }
      return false;
    };

    // Mark cells as occupied
    const occupyCells = (samples) => {
      for (const s of samples) {
        this.occupiedCells.add(this.cellKey(s.x, s.z));
      }
    };

    // Spawn first piece (Road1 or RoadX)
    const firstPiece = templates['Road1'].clone(true);
    firstPiece.visible = true;
    firstPiece.traverse((child) => { child.visible = true; });
    firstPiece.position.set(0, 0, 5);
    this.scene.add(firstPiece);
    this.roadPieces.push(firstPiece);
    firstPiece.updateMatrixWorld(true);

    // Occupy cells and add sockets to queue
    const firstSamples = sampleCenterline(firstPiece);
    occupyCells(firstSamples);

    const firstSockets = findAllSockets(firstPiece);
    for (const socket of firstSockets) {
      socket.node.updateMatrixWorld(true);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      socket.node.getWorldPosition(pos);
      socket.node.getWorldQuaternion(quat);
      openSockets.push({ pos: pos.clone(), quat: quat.clone(), type: socket.type });
    }

    console.log(`  First piece placed with ${openSockets.length} open sockets`);

    // Generate network
    let placed = 1;
    let attempts = 0;
    const maxAttempts = count * 3;

    while (placed < count && openSockets.length > 0 && attempts < maxAttempts) {
      attempts++;

      // Pick a random open socket
      const socketIdx = Math.floor(Math.random() * openSockets.length);
      const { pos, quat, type } = openSockets[socketIdx];

      // Decide which piece to place (80% Road1, 20% RoadX)
      const pieceType = Math.random() < 0.8 ? 'Road1' : 'RoadX';
      const template = templates[pieceType];
      if (!template) continue;

      const piece = template.clone(true);
      piece.visible = true;
      piece.traverse((child) => { child.visible = true; });

      // Place piece origin at socket position
      piece.position.copy(pos);
      piece.quaternion.copy(quat);

      this.scene.add(piece);
      piece.updateMatrixWorld(true);

      // Check collision
      const samples = sampleCenterline(piece);
      if (checkCollision(samples)) {
        this.scene.remove(piece);
        // Remove this socket as it's blocked
        openSockets.splice(socketIdx, 1);
        continue;
      }

      // Commit piece
      occupyCells(samples);
      this.roadPieces.push(piece);
      openSockets.splice(socketIdx, 1); // Remove used socket

      // Add new sockets to queue
      const newSockets = findAllSockets(piece);
      for (const socket of newSockets) {
        socket.node.updateMatrixWorld(true);
        const newPos = new THREE.Vector3();
        const newQuat = new THREE.Quaternion();
        socket.node.getWorldPosition(newPos);
        socket.node.getWorldQuaternion(newQuat);
        openSockets.push({ pos: newPos.clone(), quat: newQuat.clone(), type: socket.type });
      }

      placed++;
    }

    console.log(`[System 2] Network generated with ${this.roadPieces.length} pieces, ${openSockets.length} open sockets remaining`);
  }

  // SYSTEM 1: Procedurally generate road using all 4 piece types with collision detection
  async spawnProceduralRoadSystem1(count = 50) {
    console.log(`Procedurally generating ${count} road pieces...`);

    // Clear existing road pieces
    this.roadPieces.forEach(p => this.scene.remove(p));
    this.roadPieces = [];
    this.occupiedCells.clear();

    // Direction tracking to prevent spirals
    let lastCurveDir = 0;      // -1 left, 0 none, 1 right
    let sameDirCount = 0;
    let straightsSinceCurve = 99;  // Allow curves from start
    const MAX_SAME_DIR_CURVES = 2;
    const MIN_STRAIGHTS_AFTER_CURVE = 1;

    const ROAD_TYPES = {
      'road_long': { type: 'straight' },
      'road_short': { type: 'straight' },
      'road_curve_wide': { type: 'curve' },
      'road_curve_tight': { type: 'curve' }
    };

    const templates = {};

    // Load road texture
    const textureLoader = new THREE.TextureLoader();
    const roadTexture = await new Promise((resolve) => {
      textureLoader.load(
        '/Road%20Pack/Textures%20compressed/Normal+AO/initialShadingGroup_Base_Color.png',
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          resolve(texture);
        },
        undefined,
        () => resolve(null)
      );
    });

    // Load all 4 templates
    for (const type of Object.keys(ROAD_TYPES)) {
      const path = `/Road%20Pack/Road%20Pieces/${type}.glb`;
      try {
        const gltf = await new Promise((resolve, reject) => {
          this.gltfLoader.load(path, resolve, undefined, reject);
        });

        const template = gltf.scene;

        // Collect meshes FIRST to avoid infinite recursion
        const meshes = [];
        template.traverse((node) => {
          if (node.isMesh) meshes.push(node);
        });

        // Apply toon material and outlines
        meshes.forEach((node) => {
          const toonMat = new THREE.MeshToonMaterial({
            gradientMap: this.sharedGradientMap,
            side: THREE.DoubleSide
          });
          if (roadTexture) {
            toonMat.map = roadTexture;
          }
          toonMat.emissive.set(0x222222);
          toonMat.emissiveIntensity = 0.1;
          node.geometry.computeVertexNormals();
          node.material = toonMat;
          node.receiveShadow = true;
          node.castShadow = false;

          const outline = this.createOutline(node, 0.03);
          node.add(outline);
        });

        template.visible = false;
        this.scene.add(template);
        templates[type] = template;
        console.log(`  Loaded: ${type}`);
      } catch (error) {
        console.error(`Failed to load ${type}:`, error);
      }
    }

    // Track recent cells for seam tolerance
    const recentCellSets = [];

    // Helper: sample centerline from piece origin to socket_out
    const sampleCenterline = (piece) => {
      const samples = [];
      const origin = new THREE.Vector3();
      piece.getWorldPosition(origin);

      const socket = this.findSocketOut(piece);
      if (!socket) return [{ x: origin.x, z: origin.z }];

      const socketWorld = new THREE.Vector3();
      socket.getWorldPosition(socketWorld);

      const dir = socketWorld.clone().sub(origin);
      const length = dir.length();
      const steps = Math.max(Math.ceil(length / 1.0), 1);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = origin.clone().lerp(socketWorld, t);
        samples.push({ x: point.x, z: point.z });
      }
      return samples;
    };

    // Helper: check collision
    const checkCollision = (samples, recentCells) => {
      for (const s of samples) {
        const key = this.cellKey(s.x, s.z);
        if (this.occupiedCells.has(key) && !recentCells.has(key)) {
          return true;
        }
      }
      return false;
    };

    // Helper: filter by direction rules
    const filterByRules = (candidates) => {
      return candidates.filter(({ key, mirror }) => {
        const isCurve = ROAD_TYPES[key].type === 'curve';
        if (!isCurve) return true;

        if (straightsSinceCurve < MIN_STRAIGHTS_AFTER_CURVE) return false;

        const dir = mirror ? -1 : 1;
        if (dir === lastCurveDir && sameDirCount >= MAX_SAME_DIR_CURVES) return false;

        return true;
      });
    };

    // Spawn loop
    for (let i = 0; i < count; i++) {
      let placed = false;

      // Merge recent cells for seam tolerance
      const recentCells = new Set();
      for (const cellSet of recentCellSets) {
        for (const c of cellSet) recentCells.add(c);
      }

      // Build candidates
      let candidates = [];
      if (i < 3) {
        // First 3: straights only
        for (const key of Object.keys(ROAD_TYPES)) {
          if (ROAD_TYPES[key].type === 'straight') {
            candidates.push({ key, mirror: false });
          }
        }
      } else {
        // All types + mirror variants for curves
        for (const key of Object.keys(ROAD_TYPES)) {
          candidates.push({ key, mirror: false });
          if (ROAD_TYPES[key].type === 'curve') {
            candidates.push({ key, mirror: true });
          }
        }
      }

      // Apply direction rules
      candidates = filterByRules(candidates);

      // Shuffle
      for (let j = candidates.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [candidates[j], candidates[k]] = [candidates[k], candidates[j]];
      }

      // Try each candidate
      for (const { key, mirror } of candidates) {
        const template = templates[key];
        if (!template) continue;

        const piece = template.clone(true);
        piece.visible = true;
        piece.traverse((child) => { child.visible = true; });

        // Scale and mirror
        piece.scale.set(2, 2, 2);
        if (mirror) piece.scale.x *= -1;

        // Position
        if (this.roadPieces.length === 0) {
          piece.position.set(0, 0, 5);
          piece.quaternion.identity();
        } else {
          const prev = this.roadPieces[this.roadPieces.length - 1];
          const prevSocket = this.findSocketOut(prev);
          if (prevSocket) {
            prev.updateMatrixWorld(true);
            const tPos = new THREE.Vector3();
            const tQuat = new THREE.Quaternion();
            prevSocket.getWorldPosition(tPos);
            prevSocket.getWorldQuaternion(tQuat);
            piece.position.copy(tPos);
            piece.quaternion.copy(tQuat);
          }
        }

        // Add temporarily for world matrix
        this.scene.add(piece);
        piece.updateMatrixWorld(true);

        // Sample and check collision
        const samples = sampleCenterline(piece);
        if (checkCollision(samples, recentCells)) {
          this.scene.remove(piece);
          continue;
        }

        // No collision - commit
        const newCells = new Set();
        for (const s of samples) {
          const k = this.cellKey(s.x, s.z);
          newCells.add(k);
          this.occupiedCells.add(k);
        }

        recentCellSets.push(newCells);
        if (recentCellSets.length > 3) recentCellSets.shift();

        this.roadPieces.push(piece);

        // Update direction tracking
        const isCurve = ROAD_TYPES[key].type === 'curve';
        if (isCurve) {
          const dir = mirror ? -1 : 1;
          if (dir === lastCurveDir) {
            sameDirCount++;
          } else {
            sameDirCount = 1;
          }
          lastCurveDir = dir;
          straightsSinceCurve = 0;
        } else {
          straightsSinceCurve++;
        }

        placed = true;
        break;
      }

      if (!placed) {
        console.warn(`[Road] Dead end at segment ${i}. Stopping.`);
        break;
      }
    }

    console.log(`Procedural road generated with ${this.roadPieces.length} pieces`);
  }

  // Load road template and spawn connected pieces using socket_out snapping
  async spawnConnectedRoads(path, count = 10) {
    console.log(`Spawning ${count} connected road pieces from ${path}...`);

    if (!this.sharedGradientMap) {
      this.sharedGradientMap = this.createToonGradientMap();
    }

    // Load template
    let template;
    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(path, resolve, undefined, reject);
      });
      template = gltf.scene;
    } catch (error) {
      console.error('Failed to load road template:', error);
      return;
    }

    // Load road base color texture
    const textureLoader = new THREE.TextureLoader();
    const roadTexture = await new Promise((resolve) => {
      textureLoader.load(
        '/Road%20Pack/Textures%20compressed/Normal+AO/initialShadingGroup_Base_Color.png',
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;  // GLB models use non-flipped UVs
          console.log('Road texture loaded');
          resolve(texture);
        },
        undefined,
        () => {
          console.warn('Failed to load road texture');
          resolve(null);
        }
      );
    });

    // Apply toon material to template with road texture
    const meshes = [];
    template.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });

    meshes.forEach((node) => {
      const toonMat = new THREE.MeshToonMaterial({
        gradientMap: this.sharedGradientMap,
        side: THREE.DoubleSide
      });

      // Apply road texture
      if (roadTexture) {
        toonMat.map = roadTexture;
      } else if (node.material.color) {
        toonMat.color.copy(node.material.color);
      }

      toonMat.emissive.set(0x222222);
      toonMat.emissiveIntensity = 0.1;
      node.geometry.computeVertexNormals();
      node.material = toonMat;
      node.receiveShadow = true;
      node.castShadow = false;

      // Add outline
      const outline = this.createOutline(node, 0.03);
      node.add(outline);
    });

    // Debug: log all children in template to find socket marker
    console.log('Road template children:');
    template.traverse((child) => {
      if (child !== template) {
        console.log(`  - ${child.name} (${child.type})`);
      }
    });

    // Find socket_out in template
    const templateSocketOut = this.findSocketOut(template);
    if (templateSocketOut) {
      console.log(`  socket_out local pos: (${templateSocketOut.position.x.toFixed(2)}, ${templateSocketOut.position.y.toFixed(2)}, ${templateSocketOut.position.z.toFixed(2)})`);
    } else {
      console.warn('No socket_out found in road template - using bounding box');
    }

    // Start position (origin = socket_in, so place origin directly at target)
    let currentPos = new THREE.Vector3(0, 0, 5);
    let currentQuat = new THREE.Quaternion();

    // Spawn connected pieces
    for (let i = 0; i < count; i++) {
      const piece = template.clone(true);

      // Place piece origin directly at currentPos (origin IS socket_in)
      piece.position.copy(currentPos);
      piece.quaternion.copy(currentQuat);

      this.scene.add(piece);
      this.registerSelectable(piece, `road_${i}`);

      // Get socket_out world position for next piece
      piece.updateMatrixWorld(true);
      const socket = this.findSocketOut(piece);
      if (socket) {
        socket.getWorldPosition(currentPos);
        socket.getWorldQuaternion(currentQuat);
        console.log(`  Road ${i} socket_out world: (${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)}, ${currentPos.z.toFixed(2)})`);
      } else {
        // Fallback: move forward along Z
        currentPos.z += 5;
      }
    }

    console.log(`Spawned ${count} connected road pieces`);
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

  // Try to spawn a piece, checking for collisions with worldGrid
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

    // Get cells this piece would occupy (using worldGrid system)
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

    // Check collision with OTHER ROADS only (grass can be replaced)
    let hasRoadCollision = false;
    for (const cell of cells) {
      if (this.occupiedCells.has(cell) && !recentCells.has(cell)) {
        hasRoadCollision = true;
        break;
      }
    }

    if (hasRoadCollision) {
      // Remove test instance and reject
      this.scene.remove(testInstance);
      return null;
    }

    // No road collision - remove any grass tiles under this road
    const worldCells = this.sampleRoadWorldGridCells(testInstance);
    worldCells.forEach(({ gridX, gridZ }) => {
      const key = `${gridX},${gridZ}`;
      const entry = this.worldGrid.get(key);
      if (entry && entry.type === 'grass') {
        this.removeTileAt(gridX, gridZ);
      }
    });

    // Mark road cells as occupied
    cells.forEach(c => this.occupiedCells.add(c));
    this.roadPieces.push(testInstance);

    // Slight Y offset for roads to sit above any remaining grass edges
    testInstance.position.y += 0.001;

    return testInstance;
  }

  // Sample road centerline and return worldGrid cell coordinates
  sampleRoadWorldGridCells(piece) {
    const cells = [];
    const socket = this.findSocketOut(piece);
    if (!socket) return cells;

    // Get start (origin) and end (socket) positions in world space
    const start = new THREE.Vector3();
    piece.getWorldPosition(start);

    socket.updateMatrixWorld(true);
    const end = new THREE.Vector3();
    socket.getWorldPosition(end);

    // Sample every 2m along the centerline for tile-sized coverage
    const distance = start.distanceTo(end);
    const steps = Math.max(1, Math.ceil(distance / 2));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;

      // Convert to worldGrid coordinates
      const gridX = Math.round(x / this.TILE_SIZE);
      const gridZ = Math.round(z / this.TILE_SIZE);

      // Avoid duplicates
      const exists = cells.some(c => c.gridX === gridX && c.gridZ === gridZ);
      if (!exists) {
        cells.push({ gridX, gridZ });
      }
    }

    return cells;
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

          const toonMat = new THREE.MeshToonMaterial({
            gradientMap: gradientMap,
            side: THREE.DoubleSide
          });

          if (this.roadBaseColorMap) {
            toonMat.map = this.roadBaseColorMap;
          } else if (origMat.color) {
            toonMat.color.copy(origMat.color);
          }

          toonMat.emissive.set(0x333333);
          toonMat.emissiveIntensity = 0.15;

          node.geometry.computeVertexNormals();
          node.material = toonMat;
          node.receiveShadow = true;
          node.castShadow = false;

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

  toggleUI() {
    const elements = [
      document.getElementById('controls-hint'),
      document.getElementById('scene-menu'),
      document.getElementById('building-menu')
    ];

    this.uiHidden = !this.uiHidden;
    elements.forEach(el => {
      if (el) el.style.display = this.uiHidden ? 'none' : '';
    });

    // Also hide transform gizmo if visible
    if (this.uiHidden && this.transformControls) {
      this.transformControls.visible = false;
    } else if (this.transformControls) {
      this.transformControls.visible = true;
    }

    console.log(this.uiHidden ? 'UI hidden (press H to show)' : 'UI visible');
  }

  preciseZoom(amount) {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const movement = forward.multiplyScalar(amount);
    this.camera.position.add(movement);
    this.controls.target.add(movement);
  }

  resetCameraToOrigin() {
    // Smoothly animate camera back to origin view
    const targetPos = new THREE.Vector3(0, 2, 0);
    const cameraPos = new THREE.Vector3(8, 2, 12);

    // Animate over ~0.3 seconds
    const duration = 300;
    const startTime = performance.now();
    const startTarget = this.controls.target.clone();
    const startCamera = this.camera.position.clone();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      this.controls.target.lerpVectors(startTarget, targetPos, ease);
      this.camera.position.lerpVectors(startCamera, cameraPos, ease);

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };
    animate();
    console.log('Camera reset to origin');
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Show error on screen for mobile debugging
  showError(msg) {
    console.error(msg);
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:red;color:white;padding:20px;z-index:9999;max-width:80%;word-wrap:break-word;';
    div.textContent = msg;
    document.body.appendChild(div);
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
