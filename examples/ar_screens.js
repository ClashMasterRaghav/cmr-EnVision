// Screen creation and management functionality
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { scene, camera, selectedScreen, setSelectedScreen } from './ar_core.js';
import { virtualKeyboard, controlPanel } from './ar_ui.js';
import { videoTexture } from './ar_media.js';
import {
    getCalculatorHtml,
    getNotepadHtml,
    getPaintHtml,
    getMinesweeperHtml,
    getCalendarHtml,
    getVideoPlayerHtml,
    getBrowserHtml,
    getYouTubeHtml,
    getGoogleMapsHtml,
    getMyComputerHtml,
    getRecycleBinHtml,
    getXPDesktopHtml
} from './ar_xp_apps.js';

// Array to store screen objects
export let screens = [];
let css3dRenderer = null;
let css3dScene = null;

// Initialize CSS3D renderer for real web content
export function initCSS3DRenderer() {
    if (css3dRenderer) return css3dRenderer;

    css3dRenderer = new CSS3DRenderer();
    css3dRenderer.setSize(window.innerWidth, window.innerHeight);
    css3dRenderer.domElement.style.position = 'absolute';
    css3dRenderer.domElement.style.top = '0';
    css3dRenderer.domElement.style.left = '0';
    css3dRenderer.domElement.style.width = '100%';
    css3dRenderer.domElement.style.height = '100%';
    css3dRenderer.domElement.style.zIndex = '10'; // Sit above WebGL canvas so iframe touches & clicks work directly
    css3dRenderer.domElement.style.pointerEvents = 'none'; // Container is click-through, but child iframes have pointer-events: auto
    css3dRenderer.domElement.style.transformStyle = 'preserve-3d';
    css3dRenderer.domElement.style.backfaceVisibility = 'hidden';
    css3dRenderer.domElement.style.willChange = 'transform';
    document.body.appendChild(css3dRenderer.domElement);

    css3dScene = new THREE.Scene();

    window.addEventListener('resize', () => {
        if (css3dRenderer) {
            css3dRenderer.setSize(window.innerWidth, window.innerHeight);
        }
    });

    console.log("CSS3D Renderer initialized for real website & app integration");
    return css3dRenderer;
}

// Update CSS3D Renderer - called every frame in render loop
export function updateCSS3DRenderer() {
    if (css3dRenderer && css3dScene && camera) {
        // Use the sub-camera cameraL (or main camera with updated projectionMatrixInverse) so CSS3D aligns 1:1
        camera.updateMatrixWorld(true);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        css3dRenderer.render(css3dScene, camera);
    }
}

// ── SYNC CSS3D WITH SCREEN GROUP ──────────────────────────────────────────────
// Keeps the CSS3D iframe locked to the screen group position in world space
export function syncCSS3DObject(screen) {
    if (!screen || !screen.userData || !screen.userData.css3dObject) return;
    const cssObj = screen.userData.css3dObject;

    screen.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    screen.matrixWorld.decompose(worldPos, worldQuat, worldScale);

    // Minimal offset flush with screen plane
    const frontOffset = new THREE.Vector3(0, 0, 0.001).applyQuaternion(worldQuat);

    cssObj.position.copy(worldPos).add(frontOffset);
    cssObj.quaternion.copy(worldQuat);
    cssObj.scale.set(
        worldScale.x,
        worldScale.y,
        worldScale.z
    );
}

// Sync all screens every animation frame so apps never detach or float away
export function syncAllCSS3DScreens() {
    for (let i = 0; i < screens.length; i++) {
        syncCSS3DObject(screens[i]);
    }
}

// ── COMPREHENSIVE SCREEN REMOVAL & CLEANUP ────────────────────────────────────
// Fully tears down the 3D monitor chassis, unmounts CSS3D iframes from DOM,
// halts any video/audio playback immediately, and cleans up references.
export function removeScreen(screenToDelete) {
    if (!screenToDelete) return false;
    const screenId = screenToDelete.userData ? screenToDelete.userData.id : 'unknown';
    console.log("Comprehensively removing screen id:", screenId);

    // 1. Destroy and detach CSS3D iframe object & stop all media
    if (screenToDelete.userData && screenToDelete.userData.css3dObject) {
        const cssObj = screenToDelete.userData.css3dObject;
        if (css3dScene) {
            css3dScene.remove(cssObj);
        }
        if (cssObj.element) {
            try {
                // Terminate iframes to stop video/audio immediately
                if (cssObj.element.tagName === 'IFRAME') {
                    cssObj.element.src = 'about:blank';
                }
                const iframes = cssObj.element.querySelectorAll ? cssObj.element.querySelectorAll('iframe') : [];
                iframes.forEach(f => { f.src = 'about:blank'; });

                const videos = cssObj.element.querySelectorAll ? cssObj.element.querySelectorAll('video') : [];
                if (cssObj.element.tagName === 'VIDEO') {
                    cssObj.element.pause();
                    cssObj.element.src = '';
                }
                videos.forEach(v => { v.pause(); v.src = ''; });
            } catch (e) {
                console.warn("Media teardown warning:", e);
            }
            if (cssObj.element.parentNode) {
                cssObj.element.parentNode.removeChild(cssObj.element);
            }
        }
        screenToDelete.userData.css3dObject = null;
    }

    // 2. Stop WebGL video texture if this screen was using background video
    if (screenToDelete.userData && screenToDelete.userData.contentType === 'video') {
        const videoElement = document.getElementById('videoElement');
        if (videoElement) {
            videoElement.pause();
            videoElement.currentTime = 0;
        }
    }

    // 3. Remove from WebGL scene
    if (scene) {
        scene.remove(screenToDelete);
    }

    // 4. Remove from screens array
    const index = screens.indexOf(screenToDelete);
    if (index > -1) {
        screens.splice(index, 1);
        console.log("Screen removed. Remaining screens:", screens.length);
    }

    // 5. Update selection
    if (selectedScreen === screenToDelete) {
        if (screens.length > 0) {
            selectScreen(screens[screens.length - 1]);
        } else {
            setSelectedScreen(null);
        }
    }

    // 6. Dispose geometries and materials
    screenToDelete.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });

    return true;
}

// Global listener for window close button (×), app launches, and rock-solid titlebar dragging
let activeDragScreen = null;
let lastTouchX = 0;
let lastTouchY = 0;

if (typeof window !== 'undefined') {
    // 1. Listen for messages from inside iframes
    window.addEventListener('message', (event) => {
        if (!event.data) return;
        if (event.data.action === 'closeScreen') {
            const sId = event.data.screenId;
            const target = screens.find(s => s.userData && String(s.userData.id) === String(sId));
            if (target) {
                removeScreen(target);
            }
        } else if (event.data.action === 'launchApp') {
            createScreenFromButton(event.data.appType);
            // Hide control panel when an app is launched
            if (controlPanel) {
                controlPanel.visible = false;
                controlPanel.position.set(0, -9999, 0);
                const btn = document.getElementById('summonPanelBtn');
                if (btn) btn.innerHTML = '<span style="font-size: 15px;">🖐️</span><span>Menu</span>';
            }
        } else if (event.data.action === 'dragStart') {
            const sId = event.data.screenId;
            const target = screens.find(s => s.userData && String(s.userData.id) === String(sId));
            if (target) {
                selectScreen(target);
            }
        } else if (event.data.action === 'dragMove') {
            const sId = event.data.screenId;
            const target = screens.find(s => s.userData && String(s.userData.id) === String(sId));
            if (target && camera) {
                // Clamp delta per frame to prevent jumps
                const maxDelta = 40;
                const dx = Math.max(-maxDelta, Math.min(maxDelta, event.data.dx || 0));
                const dy = Math.max(-maxDelta, Math.min(maxDelta, event.data.dy || 0));

                const dist = THREE.MathUtils.clamp(target.position.distanceTo(camera.position), 0.6, 3.5);
                const sensitivity = dist * 0.0014;
                const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

                target.position.addScaledVector(camRight, dx * sensitivity);
                target.position.addScaledVector(camUp, -dy * sensitivity);

                // Keep distance bounded so it never flies away or behind user
                const toTarget = target.position.clone().sub(camera.position);
                const curDist = toTarget.length();
                if (curDist < 0.6 || curDist > 3.0) {
                    toTarget.normalize().multiplyScalar(THREE.MathUtils.clamp(curDist, 0.6, 3.0));
                    target.position.copy(camera.position).add(toTarget);
                }

                target.lookAt(camera.position);
                syncCSS3DObject(target);
            }
        } else if (event.data.action === 'dragEnd') {
            const sId = event.data.screenId;
            const target = screens.find(s => s.userData && String(s.userData.id) === String(sId));
            if (target) {
                target.userData.originalPosition = target.position.clone();
                syncCSS3DObject(target);
            }
        }
    });
}

// ── GENERIC APP SCREEN BUILDER ────────────────────────────────────────────────
// Clean raw app screen: top bar drag handle + raycast blocker behind + interactive CSS3D iframe
export function createAppScreen(position, size, title, appHtmlGen, accentColor, contentType) {
    if (!css3dRenderer) {
        initCSS3DRenderer();
    }

    const screenWidth = size.x;
    const screenHeight = size.y;
    const screenId = screens.length + 1;

    // Create a minimal group — no 3D chassis
    const screenGroup = new THREE.Group();
    screenGroup.position.copy(position);

    // 1. Raycast blocker BEHIND the app (z = -0.003) so touches never click through to the control panel!
    const blockerGeo = new THREE.PlaneGeometry(screenWidth, screenHeight);
    const blockerMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: true,
        side: THREE.DoubleSide
    });
    const blockerMesh = new THREE.Mesh(blockerGeo, blockerMat);
    blockerMesh.position.set(0, 0, -0.003);
    blockerMesh.renderOrder = 900;
    blockerMesh.userData = {
        type: 'screenBlocker',
        screen: screenGroup
    };
    screenGroup.add(blockerMesh);

    // 2. Drag handle ONLY at the TOP BAR (4.5cm height) - does NOT cover app body!
    const handleHeight = 0.045;
    const handleGeo = new THREE.PlaneGeometry(screenWidth, handleHeight);
    const handleMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.0, // Invisible overlay directly aligned over the XP title bar
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const dragHandle = new THREE.Mesh(handleGeo, handleMat);
    // Position at the very top edge of the window
    dragHandle.position.set(0, screenHeight / 2 - handleHeight / 2, 0.003);
    dragHandle.renderOrder = 2000;
    dragHandle.userData = {
        type: 'headerOverlay',
        isTopBar: true,
        screen: screenGroup
    };
    screenGroup.add(dragHandle);

    // 2b. 3D Close Button Hitbox aligned directly over the red [×] button on the top-right corner
    //     so pointing your finger or pinching at the [×] closes this specific app window!
    const closeBtnWidth  = 0.065; // Generous 6.5cm width for easy hand-pointing accuracy
    const closeBtnHeight = 0.055; // Generous 5.5cm height at top-right corner
    const closeBtnGeo = new THREE.PlaneGeometry(closeBtnWidth, closeBtnHeight);
    const closeBtnMat = new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        transparent: true,
        opacity: 0.0, // Invisible by default; glows subtle red when hand cursor hovers over it
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const closeBtnMesh = new THREE.Mesh(closeBtnGeo, closeBtnMat);
    closeBtnMesh.position.set(
        screenWidth / 2 - closeBtnWidth / 2,
        screenHeight / 2 - closeBtnHeight / 2,
        0.006 // Slightly in front of dragHandle so raycaster hits close button first
    );
    closeBtnMesh.renderOrder = 2100;
    closeBtnMesh.userData = {
        type: 'button',
        action: 'closeSingleScreen',
        screenType: 'Close',
        targetScreen: screenGroup,
        hoverColor: new THREE.Color(0xff3b30),
        originalColor: new THREE.Color(0xff3b30),
        isCloseHitbox: true
    };
    screenGroup.add(closeBtnMesh);

    // Set up userData on the group
    screenGroup.userData = {
        id: screenId,
        type: 'screen',
        isSelected: false,
        isInteractive: true,
        originalScale: new THREE.Vector3(1, 1, 1),
        contentType: contentType,
        hasRealContent: true,
        size: size,
        dragHandle: dragHandle
    };

    // 3. Create the CSS3D iframe element (1000px = 1.0 meter)
    const iframe = document.createElement('iframe');
    iframe.style.width = `${screenWidth * 1000}px`;
    iframe.style.height = `${screenHeight * 1000}px`;
    iframe.style.border = 'none';
    iframe.style.pointerEvents = 'auto'; // User can freely interact with all app content!
    iframe.style.backfaceVisibility = 'hidden';
    iframe.style.willChange = 'transform';
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.srcdoc = typeof appHtmlGen === 'function' ? appHtmlGen(screenId) : appHtmlGen;

    const css3dObj = new CSS3DObject(iframe);
    css3dObj.scale.set(1.0, 1.0, 1.0);

    // Make screen face the user when spawned
    if (camera) {
        screenGroup.lookAt(camera.position);
    }

    // Position CSS3D object flush at screen position (z offset = 0.001)
    css3dObj.position.copy(position);
    css3dObj.quaternion.copy(screenGroup.quaternion);

    screenGroup.userData.css3dObject = css3dObj;
    css3dScene.add(css3dObj);

    scene.add(screenGroup);
    screens.push(screenGroup);

    animateScreenEntrance(screenGroup);
    selectScreen(screenGroup);

    return screenGroup;
}

// ── APP SCREEN FACTORY FUNCTIONS ──────────────────────────────────────────────

// Default / Welcome Screen: Internet Explorer Browser (XP desktop removed)
export function createNewBrowserScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createBrowserScreen(position);
}

// 1. Calculator
export function createCalculatorScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 0.8, y: 0.95 }, 'Calculator', getCalculatorHtml, 0x0058E6, 'calculator');
}

// 2. Notepad
export function createNotepadScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.0, y: 0.75 }, 'Notepad', getNotepadHtml, 0x316AC5, 'notepad');
}

// 3. Paint
export function createPaintScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.1, y: 0.8 }, 'Paint', getPaintHtml, 0x5B82D7, 'paint');
}

// 4. Minesweeper
export function createMinesweeperScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 0.75, y: 0.85 }, 'Minesweeper', getMinesweeperHtml, 0x808080, 'minesweeper');
}

// 5. Calendar
export function createCalendarScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 0.9, y: 0.75 }, 'Calendar', getCalendarHtml, 0x0054E3, 'calendar');
}

// 6. Windows Media Player (Video Player)
export function createVideoPlayerScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.0, y: 0.75 }, 'Windows Media Player', getVideoPlayerHtml, 0x1A1A24, 'videoPlayer');
}

// 7. Internet Explorer (Browser)
export function createBrowserScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.1, y: 0.8 }, 'Internet Explorer', getBrowserHtml, 0x0058EE, 'browser');
}

// 8. YouTube Player
export function createYouTubeScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.0, y: 0.75 }, 'YouTube Player', getYouTubeHtml, 0xE62117, 'youtube');
}

// 9. Google Maps
export function createGoogleMapsScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.0, y: 0.75 }, 'Google Maps', getGoogleMapsHtml, 0x4285F4, 'maps');
}

// 10. My Computer
export function createMyComputerScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.0, y: 0.75 }, 'My Computer', getMyComputerHtml, 0x0054E3, 'myComputer');
}

// 11. Recycle Bin
export function createRecycleBinScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createAppScreen(position, { x: 1.0, y: 0.75 }, 'Recycle Bin', getRecycleBinHtml, 0x3258A8, 'recycleBin');
}

// 12. Windows XP Desktop removed as requested — redirects to Browser
export function createXPDesktopScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createBrowserScreen(position);
}

// Compatibility aliases
export function createDuckDuckGoScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createBrowserScreen(position);
}

export function createElectronAppScreen(position = new THREE.Vector3(0, 0, -1.5)) {
    return createYouTubeScreen(position);
}

// Create an iframe-based texture (simulated, won't actually load iframes in WebXR)
function createIframeTexture(url, width = 1024, height = 768) {
    // Create a canvas to simulate iframe content
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Add some realistic UI elements based on the URL
    // Draw header bar for any page
    ctx.fillStyle = '#f9f9f9';
    ctx.fillRect(0, 0, width, 50);

    ctx.fillStyle = '#e5e5e5';
    ctx.fillRect(0, 48, width, 2);

    // Draw content based on URL type
    if (url.includes('youtube')) {
        // Extract video ID if present
        let videoId = "Myrr9vA7j5A"; // Default to provided video
        if (url.includes('embed/')) {
            const parts = url.split('embed/');
            if (parts.length > 1) {
                videoId = parts[1].split('?')[0];
            }
        }

        // Draw YouTube style content with video thumbnail
        // Background
        ctx.fillStyle = '#0f0f0f'; // YouTube dark mode background
        ctx.fillRect(0, 50, canvas.width, canvas.height - 50);

        // Video player area
        ctx.fillStyle = '#000000';
        ctx.fillRect(50, 80, width - 100, (width - 100) * 9 / 16); // 16:9 aspect ratio

        // Draw video title below player
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px Roboto, Arial';
        ctx.textAlign = 'left';
        ctx.fillText('AR Experience Video - ID: ' + videoId, 50, (width - 100) * 9 / 16 + 100);

        // Video progress bar
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(50, (width - 100) * 9 / 16 + 50, (width - 100) * 0.2, 4); // Red progress
        ctx.fillStyle = '#3d3d3d';
        ctx.fillRect(50 + (width - 100) * 0.2, (width - 100) * 9 / 16 + 50, (width - 100) * 0.8, 4); // Dark gray remaining

        // Video controls area
        ctx.fillStyle = '#222222';
        ctx.fillRect(50, (width - 100) * 9 / 16 + 40, width - 100, 30);

        // Play button
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(70, (width - 100) * 9 / 16 + 48);
        ctx.lineTo(70, (width - 100) * 9 / 16 + 62);
        ctx.lineTo(85, (width - 100) * 9 / 16 + 55);
        ctx.closePath();
        ctx.fill();

        // Recommended videos on right side
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = '#222222';
            ctx.fillRect(width - 300, 80 + i * 120, 250, 100);

            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Roboto, Arial';
            ctx.fillText(`Recommended Video ${i + 1}`, width - 290, 150 + i * 120);
        }
    } else if (url.includes('duckduckgo')) {
        // Draw DuckDuckGo style content
        // Logo area
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(10, 50, canvas.width - 20, 150);

        // DuckDuckGo logo (simplified)
        ctx.fillStyle = '#de5833';
        ctx.beginPath();
        ctx.arc(width / 2, 120, 50, 0, Math.PI * 2);
        ctx.fill();

        // White duck silhouette in center of logo
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(width / 2, 120, 25, 0, Math.PI * 2);
        ctx.fill();

        // Search bar
        ctx.fillStyle = '#f7f7f7';
        ctx.fillRect(width / 2 - 200, 190, 400, 40);
        ctx.strokeStyle = '#de5833';
        ctx.lineWidth = 2;
        ctx.strokeRect(width / 2 - 200, 190, 400, 40);

        // Search text
        ctx.fillStyle = '#888888';
        ctx.font = '16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Search the web without being tracked...', width / 2 - 190, 210);

        // Privacy info section
        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(50, 260, width - 100, 100);
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('Privacy, simplified.', width / 2, 290);
        ctx.font = '14px Arial';
        ctx.fillText('Search privately with DuckDuckGo. We never track your searches.', width / 2, 320);
    } else if (url.includes('maps')) {
        // Draw Google Maps style content
        // Check if satellite view is requested
        const isSatellite = url.includes('satellite');

        // Maps area - different background for satellite vs regular
        if (isSatellite) {
            // Satellite view - dark blue/black with city lights
            const gradient = ctx.createLinearGradient(0, 50, 0, height);
            gradient.addColorStop(0, '#000a12');
            gradient.addColorStop(1, '#002f52');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 50, width, height - 50);

            // Draw some "city lights" as small yellow dots
            ctx.fillStyle = 'rgba(255, 240, 180, 0.5)';
            for (let i = 0; i < 300; i++) {
                const x = Math.random() * width;
                const y = 50 + Math.random() * (height - 50);
                const size = Math.random() * 2;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw some "roads" as thin white lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 15; i++) {
                const x1 = Math.random() * width;
                const y1 = 50 + Math.random() * (height - 50);
                const x2 = Math.random() * width;
                const y2 = 50 + Math.random() * (height - 50);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        } else {
            // Regular map view - light colors
            ctx.fillStyle = '#e8eaed';
            ctx.fillRect(0, 50, width, height - 50);

            // Draw some "roads"
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 6;
            for (let i = 0; i < 10; i++) {
                const x1 = Math.random() * width;
                const y1 = 50 + Math.random() * (height - 50);
                const x2 = Math.random() * width;
                const y2 = 50 + Math.random() * (height - 50);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            // Draw some "roads" as thinner gray lines
            ctx.strokeStyle = '#d4d4d4';
            ctx.lineWidth = 3;
            for (let i = 0; i < 20; i++) {
                const x1 = Math.random() * width;
                const y1 = 50 + Math.random() * (height - 50);
                const x2 = Math.random() * width;
                const y2 = 50 + Math.random() * (height - 50);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        }

        // Map search bar
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(50, 65, width - 100, 40);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        ctx.fillRect(50, 65, width - 100, 40);
        ctx.shadowBlur = 0;

        // Map controls
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(width - 50, height / 2, 25, 0, Math.PI * 2);
        ctx.fill();

        // Zoom in/out
        ctx.fillStyle = '#5f6368';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('+', width - 50, height / 2 - 10);
        ctx.fillText('−', width - 50, height / 2 + 15);

        // Map type toggle button (satellite/regular)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(width - 150, height - 80, 100, 30);
        ctx.fillStyle = '#5f6368';
        ctx.font = '14px Arial';
        ctx.fillText(isSatellite ? 'Satellite' : 'Map', width - 100, height - 60);
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4; // Improve texture quality
    texture.needsUpdate = true;

    return texture;
}

// Create a placeholder texture for Electron apps
function createElectronPlaceholderTexture(width = 1024, height = 768, videoId = null) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Draw window with title bar (Electron style)
    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#2b2e3b');
    gradient.addColorStop(1, '#1e2028');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Title bar
    ctx.fillStyle = '#121317';
    ctx.fillRect(0, 0, width, 30);

    // Window controls (macOS style)
    const controlColors = ['#FF5F56', '#FFBD2E', '#27C93F'];
    controlColors.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(20 + i * 25, 15, 8, 0, Math.PI * 2);
        ctx.fill();
    });

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Electron YouTube Viewer App', width / 2, 20);

    // Electron logo smaller and in the top left
    ctx.fillStyle = '#47848F';
    ctx.beginPath();
    ctx.arc(width - 60, 15, 12, 0, Math.PI * 2);
    ctx.fill();

    // Sidebar
    ctx.fillStyle = '#1a1b23';
    ctx.fillRect(0, 30, 50, height - 30);

    // Sidebar icons (simplified)
    const sidebarIcons = ['#', '♥', '★', '⚙'];
    sidebarIcons.forEach((icon, i) => {
        ctx.fillStyle = i === 0 ? '#ffffff' : '#666666';
        ctx.font = '18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(icon, 25, 60 + i * 40);
    });

    // YouTube player area
    ctx.fillStyle = '#000000';
    const playerWidth = width - 70;
    const playerHeight = playerWidth * 9 / 16; // 16:9 aspect ratio
    ctx.fillRect(60, 50, playerWidth, playerHeight);

    if (videoId) {
        // Add video ID to display
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`Video ID: ${videoId}`, 65, playerHeight + 65);

        // Video progress bar
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(60, playerHeight + 80, playerWidth * 0.3, 4);
        ctx.fillStyle = '#3d3d3d';
        ctx.fillRect(60 + (playerWidth * 0.3), playerHeight + 80, playerWidth * 0.7, 4);

        // Control buttons
        ctx.fillStyle = '#333333';
        ctx.fillRect(60, playerHeight + 90, playerWidth, 40);

        // Play button
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(80, playerHeight + 110);
        ctx.lineTo(100, playerHeight + 110);
        ctx.stroke();

        // Volume icon
        ctx.beginPath();
        ctx.moveTo(130, playerHeight + 105);
        ctx.lineTo(140, playerHeight + 105);
        ctx.lineTo(150, playerHeight + 100);
        ctx.lineTo(150, playerHeight + 120);
        ctx.lineTo(140, playerHeight + 115);
        ctx.lineTo(130, playerHeight + 115);
        ctx.closePath();
        ctx.fill();
    } else {
        // Show Electron logo and welcome message when no video
        // Electron logo
        ctx.fillStyle = '#47848F';
        ctx.beginPath();
        ctx.arc(width / 2, height / 2 - 50, 80, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(width / 2, height / 2 - 50, 40, 0, Math.PI * 2);
        ctx.fill();

        // Electron name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Electron', width / 2, height / 2 + 80);

        // App description
        ctx.font = '16px Arial';
        ctx.fillText('YouTube Viewer App', width / 2, height / 2 + 110);
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4; // Improve texture quality
    texture.needsUpdate = true;

    return texture;
}

// Add a drop shadow for better depth perception
function addDropShadow(screen, width, height) {
    // Create a larger, darker plane behind the screen
    const shadowWidth = width + 0.06;
    const shadowHeight = height + 0.06;
    const shadowGeometry = new THREE.PlaneGeometry(shadowWidth, shadowHeight);
    const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthTest: true
    });

    const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadowMesh.position.z = -0.005; // Behind the screen
    shadowMesh.renderOrder = 980; // Even lower render order
    shadowMesh.userData.type = 'shadow';

    screen.add(shadowMesh);

    // Add a subtle glow with darker blue color
    const glowGeometry = new THREE.PlaneGeometry(width + 0.01, height + 0.01);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x1a237e, // Dark blue glow (indigo 900)
        transparent: true,
        opacity: 0.0, // Start invisible, will show when selected
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthTest: true
    });

    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.position.z = -0.003; // Between screen and shadow
    glowMesh.renderOrder = 985; // Between shadow and border
    glowMesh.userData.type = 'glow';

    screen.add(glowMesh);
    screen.userData.glowMesh = glowMesh;
}

// Animate screen entrance with a scale-up and fade-in effect
function animateScreenEntrance(screen) {
    // Store original scale
    const targetScale = screen.scale.clone();

    // Start small and scale up
    screen.scale.set(0.5, 0.5, 0.5);

    // Animate to full size
    const duration = 300; // milliseconds
    const startTime = performance.now();

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease in-out for smoother animation
        const easedProgress = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Scale up
        screen.scale.lerpVectors(
            new THREE.Vector3(0.5, 0.5, 0.5),
            targetScale,
            easedProgress
        );

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

// ── CyberMonitor 3D Chassis Textures ──────────────────────────────────────────

function createCyberHeaderTexture(title = 'SCREEN', accentHex = 0x00e5ff) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const accentStyle = '#' + new THREE.Color(accentHex).getHexString();

    // Dark titanium sci-fi gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, '#101422');
    bgGrad.addColorStop(0.5, '#171d2e');
    bgGrad.addColorStop(1, '#0e121d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle holographic tech grid
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    // Glowing bottom accent line
    ctx.strokeStyle = accentStyle;
    ctx.lineWidth = 4;
    ctx.shadowColor = accentStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 2);
    ctx.lineTo(canvas.width, canvas.height - 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Window action dots on left (Close / Min / Max decor)
    const dots = ['#ff5f56', '#ffbd2e', '#27c93f'];
    dots.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(36 + i * 28, canvas.height / 2, 8, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Center Monitor Title
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title.toUpperCase(), canvas.width / 2, canvas.height / 2 - 10);

    // Subtitle badge
    ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = accentStyle;
    ctx.shadowColor = accentStyle;
    ctx.shadowBlur = 4;
    ctx.fillText('● CYBER-CMR // HOLOGRAPHIC DISPLAY', canvas.width / 2, canvas.height / 2 + 22);
    ctx.shadowBlur = 0;

    // Right: High-contrast prominent GRAB HANDLE BAR
    const gripW = 230;
    const gripH = 50;
    const gripX = canvas.width - gripW - 24;
    const gripY = (canvas.height - gripH) / 2;

    ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(gripX, gripY, gripW, gripH, 12);
    } else {
        ctx.rect(gripX, gripY, gripW, gripH);
    }
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('≡ DRAG TO MOVE ≡', gripX + gripW / 2, gripY + gripH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    return texture;
}

function createCyberChinTexture(accentHex = 0x00e5ff) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const accentStyle = '#' + new THREE.Color(accentHex).getHexString();

    ctx.fillStyle = '#0c0f17';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Perforated speaker grill dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let x = 60; x < canvas.width - 60; x += 16) {
        ctx.beginPath();
        ctx.arc(x, 22, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 8, 42, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Central status LED
    ctx.fillStyle = accentStyle;
    ctx.shadowColor = accentStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createCyberBackTexture(accentHex = 0x00e5ff) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const accentStyle = '#' + new THREE.Color(accentHex).getHexString();

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Heat vent lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 3;
    for (let y = 60; y < canvas.height - 60; y += 40) {
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(canvas.width - 40, y);
        ctx.stroke();
    }

    // Glowing central logo
    ctx.strokeStyle = accentStyle;
    ctx.lineWidth = 3;
    ctx.shadowColor = accentStyle;
    ctx.shadowBlur = 14;
    ctx.strokeRect(canvas.width / 2 - 70, canvas.height / 2 - 70, 140, 140);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CMR // AR', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '600 13px sans-serif';
    ctx.fillStyle = accentStyle;
    ctx.fillText('HOLO-CORE', canvas.width / 2, canvas.height / 2 + 20);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

// ── 3D CyberMonitor Creation Function ─────────────────────────────────────────

function enhancedCreateScreen(position, size, title = 'Screen', content = null, accentColor = 0x00e5ff) {
    const screen = new THREE.Group();

    const screenWidth = size.x;
    const screenHeight = size.y;
    const headerHeight = 0.08;   // 8cm prominent command header
    const chinHeight = 0.04;     // 4cm bottom chin
    const sideBezel = 0.03;      // 3cm side bezels
    const chassisDepth = 0.035;  // 3.5cm thick 3D physical body

    const totalWidth = screenWidth + sideBezel * 2;
    const totalHeight = screenHeight + headerHeight + chinHeight;
    const verticalOffset = (headerHeight - chinHeight) / 2;

    // 1. 3D Chassis Housing (Solid Back casing & Frame body)
    const chassisGeo = new THREE.BoxGeometry(totalWidth, totalHeight, chassisDepth);
    const backTex = createCyberBackTexture(accentColor);
    const chassisMaterials = [
        new THREE.MeshBasicMaterial({ color: 0x141824 }), // right
        new THREE.MeshBasicMaterial({ color: 0x141824 }), // left
        new THREE.MeshBasicMaterial({ color: 0x181d2c }), // top
        new THREE.MeshBasicMaterial({ color: 0x10131d }), // bottom
        new THREE.MeshBasicMaterial({ color: 0x12151e }), // front bezel base
        new THREE.MeshBasicMaterial({ map: backTex })      // back casing with glowing logo
    ];
    const chassisMesh = new THREE.Mesh(chassisGeo, chassisMaterials);
    chassisMesh.position.set(0, verticalOffset, 0);
    chassisMesh.renderOrder = 900;
    chassisMesh.userData = {
        type: 'dragHandle',
        isChassis: true,
        screen: screen
    };
    screen.add(chassisMesh);

    // 2. Glowing Neon Border Bevel (Edge Trim)
    const borderGeo = new THREE.PlaneGeometry(totalWidth + 0.01, totalHeight + 0.01);
    const borderMat = new THREE.MeshBasicMaterial({
        color: accentColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
    });
    const borderPanel = new THREE.Mesh(borderGeo, borderMat);
    borderPanel.position.set(0, verticalOffset, -chassisDepth / 2 - 0.001);
    borderPanel.renderOrder = 890;
    borderPanel.userData = { type: 'border', screen: screen };
    screen.add(borderPanel);
    screen.userData.borderMesh = borderPanel;

    // Ambient glow halo behind screen
    const glowGeo = new THREE.PlaneGeometry(totalWidth + 0.06, totalHeight + 0.06);
    const glowMat = new THREE.MeshBasicMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.set(0, verticalOffset, -chassisDepth / 2 - 0.003);
    glowMesh.renderOrder = 880;
    glowMesh.userData = { type: 'glow', screen: screen };
    screen.add(glowMesh);
    screen.userData.glowMesh = glowMesh;

    // 3. Command Header Bar (Top Drag Handle)
    const headerGeo = new THREE.PlaneGeometry(totalWidth, headerHeight);
    const headerTex = createCyberHeaderTexture(title, accentColor);
    const headerMat = new THREE.MeshBasicMaterial({
        map: headerTex,
        side: THREE.FrontSide,
        depthTest: true
    });
    const headerMesh = new THREE.Mesh(headerGeo, headerMat);
    const headerY = screenHeight / 2 + headerHeight / 2;
    headerMesh.position.set(0, headerY, chassisDepth / 2 + 0.003);
    headerMesh.renderOrder = 1800;
    headerMesh.userData = {
        type: 'dragHandle',
        isTopBar: true,
        screen: screen,
        originalColor: 0xffffff
    };
    screen.add(headerMesh);
    screen.userData.dragHandle = headerMesh;

    // 4. Bottom Chin Bar
    const chinGeo = new THREE.PlaneGeometry(totalWidth, chinHeight);
    const chinTex = createCyberChinTexture(accentColor);
    const chinMat = new THREE.MeshBasicMaterial({
        map: chinTex,
        side: THREE.FrontSide,
        depthTest: true
    });
    const chinMesh = new THREE.Mesh(chinGeo, chinMat);
    const chinY = -screenHeight / 2 - chinHeight / 2;
    chinMesh.position.set(0, chinY, chassisDepth / 2 + 0.003);
    chinMesh.renderOrder = 1800;
    chinMesh.userData = {
        type: 'dragHandle',
        isChin: true,
        screen: screen
    };
    screen.add(chinMesh);

    // 5. Left & Right Bezel Drag Handles
    const sideBezelGeo = new THREE.PlaneGeometry(sideBezel, screenHeight);
    const sideBezelMat = new THREE.MeshBasicMaterial({
        color: 0x151926,
        side: THREE.FrontSide
    });
    const leftBezel = new THREE.Mesh(sideBezelGeo, sideBezelMat);
    leftBezel.position.set(-screenWidth / 2 - sideBezel / 2, 0, chassisDepth / 2 + 0.002);
    leftBezel.renderOrder = 1500;
    leftBezel.userData = { type: 'dragHandle', screen: screen };
    screen.add(leftBezel);

    const rightBezel = new THREE.Mesh(sideBezelGeo, sideBezelMat);
    rightBezel.position.set(screenWidth / 2 + sideBezel / 2, 0, chassisDepth / 2 + 0.002);
    rightBezel.renderOrder = 1500;
    rightBezel.userData = { type: 'dragHandle', screen: screen };
    screen.add(rightBezel);

    // 6. Recessed Display Screen (App Content)
    const displayGeo = new THREE.PlaneGeometry(screenWidth, screenHeight);
    let displayMat;
    if (content && content.isVideoTexture) {
        displayMat = new THREE.MeshBasicMaterial({
            map: content,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true
        });
    } else if (content) {
        displayMat = new THREE.MeshBasicMaterial({
            map: content,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true
        });
    } else {
        const fallbackTex = createFallbackTexture(1);
        displayMat = new THREE.MeshBasicMaterial({
            map: fallbackTex,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true
        });
    }
    const displayMesh = new THREE.Mesh(displayGeo, displayMat);
    displayMesh.position.set(0, 0, chassisDepth / 2 + 0.001);
    displayMesh.renderOrder = 1010;
    displayMesh.userData = {
        type: 'screenDisplay',
        isContent: true,
        screen: screen
    };
    screen.add(displayMesh);
    screen.userData.displayMesh = displayMesh;

    // 7. Video Controls (Integrated onto the bottom chin)
    if (content && content.isVideoTexture) {
        const playButton = addControlButton(screen, 'pause', -0.06, chinY, 0.015);
        playButton.position.z = chassisDepth / 2 + 0.008;
        playButton.userData.videoControl = true;
        playButton.userData.videoAction = 'togglePlayback';
        playButton.userData.action = 'playButton';

        const volumeButton = addControlButton(screen, 'muted', 0.06, chinY, 0.015);
        volumeButton.position.z = chassisDepth / 2 + 0.008;
        volumeButton.userData.videoControl = true;
        volumeButton.userData.videoAction = 'toggleMute';
        volumeButton.userData.action = 'volumeButton';

        screen.userData.controls = {
            isPlaying: true,
            isMuted: true,
            playButton: playButton,
            volumeButton: volumeButton
        };
    }

    // Position the entire monitor in 3D space
    screen.position.copy(position);

    return screen;
}

// Add a control button to the screen with improved styling
function addControlButton(screen, type, x, y, size) {
    const buttonGeometry = new THREE.CircleGeometry(size, 32);
    const buttonMaterial = new THREE.MeshBasicMaterial({
        color: 0x222222, // Darker background for better contrast
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: true // Enable depth testing to prevent seeing through screens
    });
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
    button.position.set(x, y, 0.010); // Increased z-position to be in front of everything
    button.renderOrder = 20; // Very high render order to ensure it's drawn on top
    button.userData = {
        type: 'button',
        action: type + 'Button', // This will still be overridden by specific buttons with userData.action
        screen: screen
    };

    // Create icon for the button with improved design
    const iconTexture = createControlIcon(type);
    const iconSize = size * 0.7; // Smaller icon for more whitespace
    const iconGeometry = new THREE.PlaneGeometry(iconSize * 2, iconSize * 2);
    const iconMaterial = new THREE.MeshBasicMaterial({
        map: iconTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true // Enable depth testing to prevent seeing through screens
    });
    const iconMesh = new THREE.Mesh(iconGeometry, iconMaterial);
    iconMesh.position.z = 0.001; // Slightly in front of button
    iconMesh.renderOrder = 21; // Even higher than the button
    button.add(iconMesh);

    // Add subtle highlight/shadow for depth and 3D effect
    const highlightGeometry = new THREE.CircleGeometry(size * 1.02, 32);
    const highlightMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.3, // More prominent
        side: THREE.DoubleSide,
        depthTest: true // Enable depth testing to prevent seeing through screens
    });
    const highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlightMesh.position.z = -0.001; // Slightly behind the button
    button.add(highlightMesh);

    // Add hover/interaction state
    button.userData.originalColor = buttonMaterial.color.clone();
    button.userData.hoverColor = new THREE.Color(0x3498db); // Highlight blue
    button.userData.pressColor = new THREE.Color(0x2980b9); // Darker blue when pressed

    // Add subtle button border for better visibility
    const borderGeometry = new THREE.RingGeometry(size * 0.98, size * 1.02, 32);
    const borderMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthTest: true
    });
    const borderMesh = new THREE.Mesh(borderGeometry, borderMaterial);
    borderMesh.position.z = 0.0005;
    button.add(borderMesh);

    screen.add(button);
    return button;
}

// Create control button icons
function createControlIcon(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Clear canvas and set styles
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5; // Thinner lines for a more elegant look
    ctx.lineCap = 'round';

    switch (type) {
        case 'play':
            // Draw play icon (triangle)
            ctx.beginPath();
            ctx.moveTo(22, 16);
            ctx.lineTo(22, 48);
            ctx.lineTo(48, 32);
            ctx.closePath();
            ctx.fill();
            break;

        case 'pause':
            // Draw pause icon (two vertical bars)
            ctx.fillRect(22, 18, 6, 28);
            ctx.fillRect(36, 18, 6, 28);
            break;

        case 'volume':
            // Draw volume/mute icon with sleeker design
            // Speaker base
            ctx.beginPath();
            ctx.moveTo(18, 26);
            ctx.lineTo(24, 26);
            ctx.lineTo(32, 18);
            ctx.lineTo(32, 46);
            ctx.lineTo(24, 38);
            ctx.lineTo(18, 38);
            ctx.closePath();
            ctx.fill();

            // Sound waves - more subtle with thinner lines
            ctx.beginPath();
            ctx.moveTo(40, 24);
            ctx.bezierCurveTo(44, 30, 44, 34, 40, 40);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(44, 20);
            ctx.bezierCurveTo(50, 28, 50, 36, 44, 44);
            ctx.stroke();
            break;

        case 'muted':
            // Draw muted icon - speaker with X
            // Speaker base
            ctx.beginPath();
            ctx.moveTo(18, 26);
            ctx.lineTo(24, 26);
            ctx.lineTo(32, 18);
            ctx.lineTo(32, 46);
            ctx.lineTo(24, 38);
            ctx.lineTo(18, 38);
            ctx.closePath();
            ctx.fill();

            // X mark for mute - make it more visible
            ctx.lineWidth = 3.5; // Thicker line for better visibility
            ctx.strokeStyle = '#ff5555'; // Red color for emphasis

            // Draw a slightly larger X
            ctx.beginPath();
            ctx.moveTo(36, 20);
            ctx.lineTo(54, 44);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(36, 44);
            ctx.lineTo(54, 20);
            ctx.stroke();

            // Reset styles for next elements
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#ffffff';
            break;

        case 'resize':
            // Draw resize icon with inward/outward arrows
            // Outward arrow (top-left)
            ctx.beginPath();
            ctx.moveTo(16, 16);
            ctx.lineTo(28, 16);
            ctx.lineTo(28, 28);
            ctx.moveTo(16, 16);
            ctx.lineTo(28, 28);
            ctx.stroke();

            // Inward arrow (bottom-right)
            ctx.beginPath();
            ctx.moveTo(48, 48);
            ctx.lineTo(36, 48);
            ctx.lineTo(36, 36);
            ctx.moveTo(48, 48);
            ctx.lineTo(36, 36);
            ctx.stroke();
            break;

        case 'close':
            ctx.strokeStyle = '#ff5555';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(20, 20);
            ctx.lineTo(44, 44);
            ctx.moveTo(44, 20);
            ctx.lineTo(20, 44);
            ctx.stroke();
            break;

        case 'pin':
            ctx.fillStyle = '#34c759';
            ctx.beginPath();
            ctx.arc(32, 24, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#34c759';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(32, 31);
            ctx.lineTo(32, 46);
            ctx.stroke();
            break;

        case 'fullscreen':
            // Draw fullscreen icon
            ctx.beginPath();
            // Top-left corner
            ctx.moveTo(18, 26);
            ctx.lineTo(18, 18);
            ctx.lineTo(26, 18);

            // Top-right corner
            ctx.moveTo(38, 18);
            ctx.lineTo(46, 18);
            ctx.lineTo(46, 26);

            // Bottom-right corner
            ctx.moveTo(46, 38);
            ctx.lineTo(46, 46);
            ctx.lineTo(38, 46);

            // Bottom-left corner
            ctx.moveTo(26, 46);
            ctx.lineTo(18, 46);
            ctx.lineTo(18, 38);
            ctx.stroke();
            break;

        default:
            // For any unrecognized type, draw a question mark
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', canvas.width / 2, canvas.height / 2);
            console.warn('Unknown icon type:', type);
            break;
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// Create a fallback texture when video is not available
function createFallbackTexture(screenNumber) {
    // Create a canvas to draw fallback content
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 460;

    const ctx = canvas.getContext('2d');

    // Fill background (YouTube-style dark background)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw YouTube-style loading icon (spinning circle)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 50, 0, 1.8 * Math.PI);
    ctx.stroke();

    // Draw message
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Loading video content...', canvas.width / 2, canvas.height / 2 + 100);
    ctx.font = '16px Roboto, Arial';
    ctx.fillText('Tap to interact with the player', canvas.width / 2, canvas.height / 2 + 140);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return texture;
}

// Select a screen and update UI accordingly with enhanced visual feedback
export function selectScreen(screen) {
    // Deselect previously selected screen
    if (selectedScreen) {
        selectedScreen.userData.isSelected = false;

        // Subtle drag handle dim on deselect
        const prevHandle = selectedScreen.userData.dragHandle;
        if (prevHandle && prevHandle.material) {
            prevHandle.material.opacity = 0.25;
        }

        // Scale down slightly for visual deselection
        selectedScreen.scale.multiplyScalar(0.97);
        // Animate back to original scale
        animateScreenScale(selectedScreen, 1.0, 150);
    }

    // If screen is null, just clear selection
    if (!screen) {
        // Update both local and global references
        setSelectedScreen(null);
        return;
    }

    // Select new screen
    setSelectedScreen(screen);
    screen.userData.isSelected = true;

    // Log selection for debugging
    console.log("Selected screen with ID:", screen.userData.id, "UUID:", screen.uuid.substring(0, 8) + "...");

    // Subtle drag handle highlight on select
    const curHandle = screen.userData.dragHandle;
    if (curHandle && curHandle.material) {
        curHandle.material.opacity = 0.45;
    }

    // Scale up slightly for visual selection
    screen.scale.multiplyScalar(1.03);
    // Animate back to original scale with slight bounce
    animateScreenScale(screen, 1.0, 300, true);

    // Position keyboard under selected screen if needed
    if (virtualKeyboard) {
        updateKeyboardPosition(screen);
    }
}

// Animate screen scale with optional bounce effect
function animateScreenScale(screen, targetScale, duration, bounce = false) {
    const originalScale = screen.userData.originalScale || new THREE.Vector3(1, 1, 1);
    const startScale = screen.scale.clone();
    const targetVector = new THREE.Vector3().copy(originalScale).multiplyScalar(targetScale);

    const startTime = performance.now();

    function animate() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease in-out for smoother animation
        const easedProgress = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Apply bounce effect if requested
        let finalProgress = easedProgress;
        if (bounce && progress > 0.7) {
            // Add a subtle bounce at the end
            const bounceAmount = Math.sin((progress - 0.7) * Math.PI * 5) * 0.02;
            finalProgress = easedProgress + bounceAmount;
        }

        // Update scale
        screen.scale.lerpVectors(
            startScale,
            targetVector,
            finalProgress
        );

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}

// Update keyboard position relative to the selected screen
export function updateKeyboardPosition(screen) {
    if (!virtualKeyboard) return;

    const screenPos = screen.position.clone();
    const screenScale = screen.scale.clone();

    // Position keyboard under selected screen, accounting for screen scale
    virtualKeyboard.position.set(
        screenPos.x,
        screenPos.y - (0.3 + 0.15 * screenScale.y), // Adjust for screen height
        screenPos.z + 0.02
    );

    // Scale keyboard proportionally to screen
    const keyboardScale = Math.max(0.8, Math.min(1.2, (screenScale.x + screenScale.y) / 2));
    virtualKeyboard.scale.set(keyboardScale, keyboardScale, 1);

    // Make keyboard face the user
    virtualKeyboard.lookAt(camera.position);
    virtualKeyboard.rotation.x = -Math.PI / 8;
}

// Update visual effects for screens (rock-solid, zero wave or bobbing)
export function updateScreenEffects() {
    screens.forEach(screen => {
        // Update CSS3D object position if the screen has custom updater
        if (screen.userData.hasRealContent && screen.userData.updateCSS3DPosition) {
            screen.userData.updateCSS3DPosition();
        }
    });
}

// Create a screen from button press - used to connect UI buttons to screen creation
export function createScreenFromButton(screenType, position) {
    // Auto-dismiss control panel when an app is opened to keep AR view clean and uncluttered
    if (typeof controlPanel !== 'undefined' && controlPanel) {
        controlPanel.visible = false;
        controlPanel.position.set(0, -9999, 0);
        const btn = document.getElementById('summonPanelBtn');
        if (btn) btn.innerHTML = '<span style="font-size: 15px;">🖐️</span><span>Menu</span>';
    }

    // Default position is in front of the camera
    if (!position) {
        position = new THREE.Vector3(0, 0, -1.5);

        // If camera exists, place screen in front of camera
        if (camera) {
            // Get camera direction
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            // Position 1.5 meters in front of camera
            position.copy(camera.position).addScaledVector(direction, 1.5);
        }
    }

    console.log(`Creating ${screenType} screen from button at position:`, position);

    // Create appropriate screen based on type
    switch (String(screenType).toLowerCase()) {
        case 'calc':
        case 'calculator':
            return createCalculatorScreen(position);
        case 'note':
        case 'notepad':
            return createNotepadScreen(position);
        case 'paint':
            return createPaintScreen(position);
        case 'mine':
        case 'minesweeper':
            return createMinesweeperScreen(position);
        case 'cal':
        case 'calendar':
            return createCalendarScreen(position);
        case 'media':
        case 'videoplayer':
        case 'wmp':
            return createVideoPlayerScreen(position);
        case 'youtube':
            return createYouTubeScreen(position);
        case 'maps':
        case 'googlemaps':
            return createGoogleMapsScreen(position);
        case 'comp':
        case 'mycomputer':
            return createMyComputerScreen(position);
        case 'bin':
        case 'recyclebin':
            return createRecycleBinScreen(position);
        case 'desktop':
        case 'xp':
            return createXPDesktopScreen(position);
        case 'ie':
        case 'browser':
        case 'duckduckgo':
        case 'search':
        default:
            return createBrowserScreen(position);
    }
} 