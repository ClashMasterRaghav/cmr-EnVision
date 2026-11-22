// Core AR functionality for initialization, scene setup, and render loop
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { createControlPanel, setupControlPanel, controlPanel } from './ar_ui.js';
import { createNewBrowserScreen, selectScreen, screens, removeScreen, updateScreenEffects, syncAllCSS3DScreens, updateCSS3DRenderer } from './ar_screens.js';
import { setupEventListeners, setupVideoControls, showControlPanelInstructions } from './ar_interaction.js';
import { initUI, createNotification } from './ar_ui.js';
import { loadVideoTexture, toggleVideoPlayback, toggleVideoMute, updateVideoTextures } from './ar_media.js';
import { initHandTracking, updateHands, setControlPanelRef } from './ar_hands.js';

// Global variables exported for use in other modules
export let camera, scene, renderer;
export let controller, controllerGrip;
export let font;
export let raycaster = new THREE.Raycaster();
export let workingMatrix = new THREE.Matrix4();
export let isPlacingScreen = false;
export let newScreen = null;
export let isMovingScreen = false;
export let isMoveModeActive = false;
export let isRotateModeActive = false;
export let selectedScreen = null;
export let selectedKey = null;
export let container;
export let isARMode = false;
export let lastCameraPosition = new THREE.Vector3();
export let lastCameraRotation = new THREE.Euler();

// Track if the AR application has been initialized
let isARInitialized = false;

// ── Setter functions for state that other modules need to mutate ──────────────
// ES module live-bindings are read-only in importing modules, so we expose
// explicit setters instead of expecting direct assignment to work.
export function setSelectedScreen(screen) {
    console.log("Setting global selectedScreen to:", screen ? (screen.userData && screen.userData.id ? screen.userData.id : "unknown") : "null");
    selectedScreen = screen;
}
export function setIsMoveModeActive(val)   { isMoveModeActive   = val; }
export function setIsRotateModeActive(val) { isRotateModeActive = val; }
export function setIsPlacingScreen(val)    { isPlacingScreen    = val; }
export function setNewScreen(val)          { newScreen          = val; }

// Main initialization function called from ar_main.js
export function initAR() {
    // Prevent multiple initializations
    if (isARInitialized) {
        console.log("AR application already initialized, skipping.");
        return;
    }
    
    try {
        console.log("Initializing AR application...");
        initAREnvironment();
        return true;
    } catch (error) {
        console.error("Error initializing AR:", error);
        // Show error in console only to avoid circular dependencies
        console.error("Error initializing AR: " + error.message);
        return false;
    }
}

// Initialize the AR environment
function initAREnvironment() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // Lighting
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // ── Hide loading message immediately — renderer canvas is now in the DOM ──
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) loadingMessage.style.display = 'none';

    // ── AR Button ─────────────────────────────────────────────────────────────
    // ARButton.createButton() checks navigator.xr asynchronously.
    // On desktop/non-WebXR browsers it returns a styled <a> link.
    // We restyle AFTER appendChild so the button is in the DOM and its async
    // callback (showStartAR / showARNotSupported) won't clobber our styles
    // (they only change display, cursor, left, width, textContent).
    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.body },
        optionalFeatures: ['dom-overlay', 'light-estimation', 'hand-tracking', 'camera-access']
    });
    document.body.appendChild(arButton);

    // Apply futuristic cyber styling — these properties don't conflict with
    // what ARButton's internal async callbacks set (display, cursor, left, width, textContent)
    const cyberStyle = {
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '9999',
        pointerEvents: 'auto',
        borderRadius: '28px',
        padding: '12px 28px',
        background: 'linear-gradient(135deg, #0a1628 0%, #0e2040 100%)',
        color: '#00e5ff',
        border: '1.5px solid #00e5ff',
        boxShadow: '0 0 20px rgba(0,229,255,0.5), 0 4px 24px rgba(0,0,0,0.6)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace",
        fontSize: '13px',
        fontWeight: '700',
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        textDecoration: 'none',
        backdropFilter: 'blur(10px)',
        outline: 'none',
        cursor: 'pointer'
    };
    Object.assign(arButton.style, cyberStyle);

    // Re-apply our layout styles after ARButton's async callback alters left/width/display.
    // Disconnect the observer temporarily to avoid infinite mutation loops.
    let _obsLocked = false;
    const reapplyCyberLayout = () => {
        if (_obsLocked) return;
        _obsLocked = true;
        arButton.style.position  = 'fixed';
        arButton.style.left      = '50%';
        arButton.style.transform = 'translateX(-50%)';
        arButton.style.bottom    = '24px';
        arButton.style.zIndex    = '9999';
        arButton.style.width     = 'auto';
        // Re-enable after microtask so the observer doesn't re-fire on our own writes
        Promise.resolve().then(() => { _obsLocked = false; });
    };
    if (window.MutationObserver) {
        const obs = new MutationObserver(reapplyCyberLayout);
        obs.observe(arButton, { attributes: true, attributeFilter: ['style'] });
    }
    
    // Helper to close all open app screens when entering or leaving AR so apps never carry over
    function clearAllScreens() {
        if (screens && screens.length > 0) {
            while (screens.length > 0) {
                removeScreen(screens[screens.length - 1]);
            }
        }
    }

    // Add event listener for session start
    renderer.xr.addEventListener('sessionstart', function() {
        console.log("AR session started - clearing pre-AR apps and showing panel instructions");
        clearAllScreens();
        showControlPanelInstructions();
    });
    
    // Add event listener for session end
    renderer.xr.addEventListener('sessionend', function() {
        console.log("AR session ended - closing all AR apps");
        // Ensure body stays visible even if ARButton tried to hide domOverlay.root
        document.body.style.display = '';
        if (window.__suppressARReload) {
            window.__suppressARReload = false;
            console.log("Hand-Cam AR passthrough active — skipping screen clear");
            return;
        }
        clearAllScreens();
    });

    // Load font for text labels (3D notifications etc.)
    const fontLoader = new FontLoader();
    fontLoader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', function(loadedFont) {
        font = loadedFont;
        // Font is now available for any future 3D text — UI panels are already created.
    });

    // Controller setup
    controller = renderer.xr.getController(0);
    
    // Add controller event listeners
    controller.addEventListener('selectstart', function() {
        controller.userData.isSelecting = true;
    });
    
    controller.addEventListener('selectend', function() {
        controller.userData.isSelecting = false;
    });
    
    scene.add(controller);

    // Controller model
    const controllerModelFactory = new XRControllerModelFactory();
    controllerGrip = renderer.xr.getControllerGrip(0);
    controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
    scene.add(controllerGrip);

    // Pointer for interaction - SMALLER SIZE
    const geometry = new THREE.SphereGeometry(0.005, 16, 16); // Reduced size
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff }); // Cyan for better visibility
    const pointer = new THREE.Mesh(geometry, material);
    pointer.position.z = -0.1;
    controller.add(pointer);

    // Window resize handler
    window.addEventListener('resize', onWindowResize);

    // Initialize UI elements (creates control panel + virtual keyboard — exactly once)
    initUI();

    // Load video texture — called once here; ar_main.js must NOT call it again
    console.log("Initializing video functionality");
    loadVideoTexture();

    // Connect video controls to the interaction module
    setupVideoControls({
        toggleVideoPlayback,
        toggleVideoMute
    });

    // Setup event listeners — called once here; ar_main.js must NOT call it again
    setupEventListeners();

    // Initialise hand tracking (optionalFeature — graceful no-op if unsupported)
    window.__arCamera = camera;
    initHandTracking(controlPanel, renderer, scene, camera);

    // Start the unified render loop (render() does everything — no separate animate())
    renderer.setAnimationLoop(render);

    // Create initial screen
    createStartScreen();

    // Set initialization flag to prevent duplicate setup
    isARInitialized = true;

    console.log("AR experience initialized successfully");
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ── Unified render loop ───────────────────────────────────────────────────────
// Previously split across animate() + render(), causing updateVideoTextures()
// to only run once. Now everything lives in a single function set via
// renderer.setAnimationLoop(render).
export function animate() {
    // Legacy export kept for backward-compat — delegates to render().
    // Do NOT call renderer.setAnimationLoop inside here.
    render();
}

// Render function — called every frame by renderer.setAnimationLoop
export function render(timestamp, frame) {
    // ── Video texture update (every frame) ───────────────────────────────────
    updateVideoTextures();

    // ── AR mode flag ─────────────────────────────────────────────────────────
    isARMode = renderer.xr.isPresenting;

    // ── Hand tracking update (every frame: supports both WebXR XRHand and MediaPipe Hand Cam) ──
    updateHands(frame);
    // Handle screen placement or movement with controller
    if ((isPlacingScreen && newScreen) || (isMovingScreen && selectedScreen)) {
        const target = isPlacingScreen ? newScreen : selectedScreen;
        
        // Get controller position and direction
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(controller.matrixWorld);
        const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix);
        
        // Set position in front of controller
        const targetPosition = position.clone().addScaledVector(direction, 0.8);
        target.position.copy(targetPosition);
        
        // Make screen face the user
        target.lookAt(camera.position);
    }
    
    // Handle screen rotation with controller
    if (isRotateModeActive && selectedScreen) {
        // Get controller movement and rotation
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        
        // Extract controller orientation
        const controllerDirection = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix);
        
        // Get controller quaternion
        const controllerQuaternion = new THREE.Quaternion().setFromRotationMatrix(tempMatrix);
        
        // Get controller Euler angles
        const controllerEuler = new THREE.Euler().setFromQuaternion(controllerQuaternion);
        
        // Extract rotation values with sensitivity adjustment
        const xRotation = controllerEuler.x * 0.5; // Pitch
        const yRotation = controllerEuler.y * 0.5; // Yaw
        
        // Apply smooth rotation
        selectedScreen.rotation.x = THREE.MathUtils.lerp(
            selectedScreen.rotation.x,
            xRotation, 
            0.1
        );
        
        selectedScreen.rotation.y = THREE.MathUtils.lerp(
            selectedScreen.rotation.y,
            yRotation, 
            0.1
        );
        
        // Optional: add subtle rotation based on controller movement for fine-tuning
        selectedScreen.rotation.y += controllerDirection.x * 0.01;
        selectedScreen.rotation.x += controllerDirection.y * 0.01;
        
        // Limit rotation angles to avoid extreme angles
        selectedScreen.rotation.x = THREE.MathUtils.clamp(
            selectedScreen.rotation.x,
            -Math.PI / 2,  // Limit to 90 degrees up
            Math.PI / 2    // Limit to 90 degrees down
        );
    }
    
    // Handle screen movement if move mode is active
    if (isMoveModeActive && selectedScreen) {
        // Check if controller trigger/button is pressed
        if (controller.userData && controller.userData.isSelecting) {
            // Get controller position and direction
            const tempMatrix = new THREE.Matrix4();
            tempMatrix.identity().extractRotation(controller.matrixWorld);
            const position = new THREE.Vector3();
            position.setFromMatrixPosition(controller.matrixWorld);
            const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix);
            
            // Set position with slight lag for smoother movement
            const targetPosition = position.clone().addScaledVector(direction, 0.8);
            selectedScreen.position.lerp(targetPosition, 0.85);
        }
    }
    
    // Note: Previously, setupControlPanel() was called here on camera movement,
    // causing the panel to slide on its own and get lost below the view.
    // The panel position is now stable or anchored via hand tracking (ar_hands.js) / manual dragging.
    
    // 1. Render WebGL scene first — updates the WebXR camera pose from ARCore tracking for the current frame
    renderer.render(scene, camera);

    // 2. Update screen visual effects (rock-solid, no wave)
    updateScreenEffects();

    // 3. Synchronize all CSS3D app positions using the fresh camera pose and render CSS3D in exact lockstep
    syncAllCSS3DScreens();
    updateCSS3DRenderer();
}

// Initialize clean start state (no pre-opened apps on the Start AR screen!)
function createStartScreen() {
    // Keep control panel hidden on the initial Start AR screen until user opens Menu or enters AR
    if (controlPanel) {
        controlPanel.visible = false;
        controlPanel.position.set(0, -9999, 0);
    }
}