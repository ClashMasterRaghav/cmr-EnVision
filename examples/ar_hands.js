// ar_hands.js — Hand Tracking, Gesture Recognition & App Launcher Module
// Supports:
//   1. WebXR Native Hand Tracking (XRHand) on XR headsets (Quest / Vision Pro / Android XR)
//   2. MediaPipe Hands Camera Tracking (via live webcam / front or rear phone camera)
//   3. WebXR Raw Camera Access fallback when Android ARCore locks the rear camera
//   4. 3-Finger Screen Palm Tap gesture on mobile WebXR
//   5. Futuristic Floating HUD Summon Pill + Hand Cam Toggle in DOM Overlay
//
// Gestures → Actions:
//   🖐️ Open Palm (5 extended fingers, 320ms hold) → Summon & Anchor Control Panel in front of user
//   ☝️ Index Point / Hover over App Icon          → Aim 3D cursor + Dwell 1.0s to launch app hands-free
//   🤏 Pinch (Thumb + Index tip touch)            → Instant click to launch hovered App OR grab & drag 3D screens
//   ✊ Closed Fist (380ms hold)                   → Dismiss Control Panel

import * as THREE from 'three';
import { createScreenFromButton, screens, removeScreen, selectScreen, syncCSS3DObject } from './ar_screens.js';
import { createNotification } from './ar_ui.js';

// ─── State ────────────────────────────────────────────────────────────────────
let handsSupported = false;
const trackedHands = new Map(); // handedness → XRInputSource

let _controlPanel = null;
let _renderer     = null;
let _scene        = null;
let _camera       = null;
let panelVisible  = false;
let panelLocked   = false;

// Gesture hold timers (longer intentional hold so the Control Panel doesn't open accidentally)
let openPalmStartTime = 0;
let fistStartTime     = 0;
let lastGestureTime   = 0;
const OPEN_PALM_HOLD_MS   = 1150; // Hold full open palm for ~1.15s to summon menu intentionally
const FIST_HOLD_MS        = 900;  // Hold closed fist for ~0.9s to close menu
const GESTURE_COOLDOWN_MS = 2200; // 2.2s cooldown between gesture toggles

// Hover / Dwell & Pinch interaction state
let hoveredButton       = null;
let hoverStartTime      = 0;
const DWELL_CLICK_MS    = 1350; // Hold cursor on app icon for ~1.35s to launch hands-free
let wasPinching         = false;
let lastClickTime       = 0;
const CLICK_COOLDOWN_MS = 1000;

// Pinch-to-drag screen state (supports 3D X/Y movement + Z depth push/pull based on hand size!)
let pinchedScreen       = null;
let _pinchInitialPalmSize = 0;
let _pinchInitialScreenDist = 1.5;
let _currentPalmSize    = 0.1;
const _pinchDragPlane   = new THREE.Plane();
const _pinchDragOffset  = new THREE.Vector3();

// Raycaster & reusable math objects
const _handRaycaster = new THREE.Raycaster();
const _palmCenter    = new THREE.Vector3();
const _tipPos        = new THREE.Vector3();
const _thumbPos      = new THREE.Vector3();
const _indexBasePos  = new THREE.Vector3();
const _rayDir        = new THREE.Vector3();
const _panelTarget   = new THREE.Vector3();
const _smoothedNdc   = new THREE.Vector2(0, 0);

// 3D Hand Cursor & Laser Visuals (for WebXR 3D space)
let _cursorGroup3D = null;
let _cursorRing3D  = null;
let _laserLine3D   = null;

// DOM Virtual Hand Cursor & MediaPipe HUD Elements
let _domCursor      = null;
let _domCursorRing  = null;
let _domCursorLabel = null;
let _camPreviewBox  = null;
let _camVideo       = null;
let _camCanvas      = null;
let _camCtx         = null;
let _gestureBadge   = null;
let _camToggleBtn   = null;

// Offscreen 2D canvas used to rasterize mobile camera frames before feeding MediaPipe
let _feedCanvas     = null;
let _feedCtx        = null;

// MediaPipe HandLandmarker state
const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
let _mpHandLandmarker = null;
let _mpLoading        = false;
let _mpActive         = false;
let _mpStream         = null;
// On mobile phones, default to rear camera ('environment') so users can hold their hand in front of the phone in AR
let _mpFacingMode     = isMobileDevice ? 'environment' : 'user';
let _lastDetectMs     = 0;
let _mpDetectCounter  = 0;

// WebXR Raw Camera Access state (for Android ARCore when getUserMedia is hardware-locked)
let _xrGlBinding      = null;
let _xrReadFbo        = null;
let _xrCaptureCanvas  = null;
let _xrCaptureCtx     = null;
let _usingXrCamera    = false;

// ─── Joint name constants for WebXR XRHand ────────────────────────────────────
const FINGERTIPS = [
    'thumb-tip',
    'index-finger-tip',
    'middle-finger-tip',
    'ring-finger-tip',
    'pinky-finger-tip',
];

const PALM_BASE_JOINTS = [
    'wrist',
    'index-finger-metacarpal',
    'middle-finger-metacarpal',
    'ring-finger-metacarpal',
    'pinky-finger-metacarpal',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call once after the renderer and scene are ready.
 */
export function initHandTracking(controlPanelRef, rendererRef = null, sceneRef = null, cameraRef = null) {
    _controlPanel = controlPanelRef;
    if (rendererRef) _renderer = rendererRef;
    if (sceneRef)    _scene    = sceneRef;
    if (cameraRef)   _camera   = cameraRef;

    // Attach global helper so buttons and touch gestures can summon panel
    window.summonControlPanelAtCamera = spawnPanelAtCamera;

    // Setup HUD buttons, virtual cursor, and camera gesture overlay
    _setupHUDAndOverlays();

    // Setup 3D cursor & laser mesh in Three.js scene
    if (_scene) {
        _setup3DCursor(_scene);
    }

    // Setup touchscreen 3+ finger palm tap gesture right away
    _setupTouchPalmSummon();

    // Pre-request camera permission at startup (or on first screen touch) so permission is already granted before entering AR!
    _prewarmCameraPermission();

    if (!_renderer || !_renderer.xr) {
        console.warn('[hands] Renderer or XR not ready — WebXR hand events skipped, MediaPipe Cam still available.');
        return;
    }

    _renderer.xr.addEventListener('sessionstart', _onSessionStart);
    _renderer.xr.addEventListener('sessionend',   _onSessionEnd);

    console.log('[hands] Hand tracking & gesture app launcher initialized.');
}

/**
 * Update the control panel reference (call if panel is recreated).
 */
export function setControlPanelRef(ref) {
    _controlPanel = ref;
}

/**
 * Toggles the control panel: dismisses it if already visible, or spawns/brings
 * it right in front of the camera at a comfortable view angle if hidden.
 */
export function spawnPanelAtCamera(forceState = null) {
    if (!_controlPanel) return;
    const cam = _camera || (window.__arCamera || null);
    if (!cam) return;

    const btn = document.getElementById('summonPanelBtn');
    const shouldShow = forceState !== null ? forceState : !_controlPanel.visible;

    // Dismiss panel
    if (!shouldShow) {
        _controlPanel.visible = false;
        panelVisible = false;
        _controlPanel.position.set(0, -9999, 0);
        if (btn) btn.innerHTML = '<span style="font-size: 15px;">🖐️</span><span>Menu</span>';
        _clearHoveredButton();
        console.log('[hands] Control panel dismissed.');
        return;
    }

    // Get true world position & orientation of the camera (critical inside WebXR on mobile phones!)
    const camWorldPos = new THREE.Vector3();
    const camWorldQuat = new THREE.Quaternion();
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(camWorldPos);
    cam.getWorldQuaternion(camWorldQuat);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camWorldQuat);

    // Position 0.85m in front of user, slightly below eye level (-0.08m)
    _panelTarget.copy(camWorldPos)
        .addScaledVector(forward, 0.85)
        .add(new THREE.Vector3(0, -0.08, 0));

    _controlPanel.position.copy(_panelTarget);
    _controlPanel.lookAt(camWorldPos);

    _controlPanel.visible = true;
    panelVisible = true;
    panelLocked = true;
    _controlPanel.userData.manuallyPositioned = true;
    _controlPanel.userData.isDragging = false;
    if (btn) btn.innerHTML = '<span style="font-size: 14px;">✕</span><span>Close</span>';

    console.log('[hands] Control panel summoned & anchored at camera.');
}

/**
 * Call every frame from the render loop.
 * Handles both WebXR XRHand and MediaPipe Hand Cam.
 * @param {XRFrame} [frame]
 */
export function updateHands(frame) {
    // 1. Process MediaPipe Camera Hand Tracking if active
    if (_mpActive) {
        _updateMediaPipeHands(frame);
    }

    // 2. Process WebXR native XRHand tracking if supported in current XR session
    if (!frame || !handsSupported || !_renderer || !_renderer.xr) return;

    const session  = _renderer.xr.getSession();
    const refSpace = _renderer.xr.getReferenceSpace();
    if (!session || !refSpace) return;

    let anyPalmOpen  = false;
    let anyFist      = false;
    let pointerRay   = null;
    let isPinching   = false;

    for (const source of session.inputSources) {
        if (!source.hand) continue;

        const palmResult = _detectOpenPalmXR(frame, refSpace, source.hand);
        if (palmResult.detected) {
            anyPalmOpen = true;
        }

        if (_detectFistXR(frame, refSpace, source.hand)) {
            anyFist = true;
        }

        const pointResult = _detectPointAndPinchXR(frame, refSpace, source.hand);
        if (pointResult.valid) {
            pointerRay = pointResult;
            isPinching = pointResult.isPinching;
        }
    }

    const now = performance.now();

    // ── Gesture state machine (Open Palm = Summon, Fist = Dismiss) ─────────
    if (anyPalmOpen && !isPinching) {
        fistStartTime = 0;
        if (!panelVisible && (now - lastGestureTime > GESTURE_COOLDOWN_MS)) {
            if (openPalmStartTime === 0) openPalmStartTime = now;
            if (now - openPalmStartTime >= OPEN_PALM_HOLD_MS) {
                spawnPanelAtCamera(true);
                createNotification('🖐️ Open Palm: Control Panel Summoned!', 'info');
                openPalmStartTime = 0;
                lastGestureTime = now;
            }
        }
    } else {
        openPalmStartTime = 0;
        if (anyFist && panelVisible && !isPinching && (now - lastGestureTime > GESTURE_COOLDOWN_MS)) {
            if (fistStartTime === 0) fistStartTime = now;
            if (now - fistStartTime >= FIST_HOLD_MS) {
                spawnPanelAtCamera(false);
                createNotification('✊ Fist Gesture: Control Panel Dismissed', 'info');
                fistStartTime = 0;
                lastGestureTime = now;
            }
        } else {
            fistStartTime = 0;
        }
    }

    // ── 3D Index Finger Raycasting, Pinch-to-Open App & Dwell-Click ────────
    if (pointerRay) {
        _handRaycaster.ray.origin.copy(pointerRay.origin);
        _handRaycaster.ray.direction.copy(pointerRay.direction);
        _processRayInteraction(isPinching, true, pointerRay.origin, pointerRay.direction);
    } else if (_cursorGroup3D) {
        _cursorGroup3D.visible = false;
        if (_laserLine3D) _laserLine3D.visible = false;
    }
}

export function lockPanel() {
    panelLocked = true;
    if (_controlPanel) {
        _controlPanel.userData.manuallyPositioned = true;
        _controlPanel.userData.isDragging = false;
    }
}

export function unlockPanel() {
    panelLocked = false;
    if (_controlPanel) _controlPanel.userData.manuallyPositioned = false;
}

export function isPanelLocked()           { return panelLocked; }
export function isHandTrackingSupported() { return handsSupported || _mpActive; }

// ─── Core Raycast & App Launching Logic (Shared by WebXR & MediaPipe) ─────────

function _getInteractiveButtons() {
    const buttons = [];
    if (_controlPanel && _controlPanel.visible) {
        _controlPanel.children.forEach(child => {
            if (child.userData && child.userData.type === 'button') {
                buttons.push(child);
            }
        });
    }
    if (screens && screens.length > 0) {
        screens.forEach(s => {
            s.children.forEach(child => {
                if (child.userData && child.userData.type === 'button') {
                    buttons.push(child);
                }
            });
        });
    }
    return buttons;
}

function _findParentButton(obj) {
    let curr = obj;
    while (curr) {
        if (curr.userData && curr.userData.type === 'button') return curr;
        curr = curr.parent;
    }
    return null;
}

function _processRayInteraction(isPinching, is3DRay = false, rayOrigin = null, rayDir = null) {
    const now = performance.now();
    const cam = _camera || window.__arCamera;

    // 1. Handle active Pinch-Drag on a 3D app window (moves X/Y and pushes/pulls closer/further with hand distance!)
    if (pinchedScreen) {
        if (isPinching && cam) {
            const camWorldPos = new THREE.Vector3();
            cam.getWorldPosition(camWorldPos);
            const planeHit = new THREE.Vector3();
            if (_handRaycaster.ray.intersectPlane(_pinchDragPlane, planeHit)) {
                const targetPos = planeHit.sub(_pinchDragOffset);

                // Adjust depth (closer/further) dynamically as user moves their pinched hand closer or further from camera!
                let desiredDist = _pinchInitialScreenDist;
                if (_pinchInitialPalmSize > 0.02 && _currentPalmSize > 0.02) {
                    const sizeRatio = THREE.MathUtils.clamp(_currentPalmSize / _pinchInitialPalmSize, 0.5, 2.0);
                    // Hand closer to camera (sizeRatio > 1) -> pulls screen closer; hand further -> pushes screen further
                    desiredDist = THREE.MathUtils.clamp(_pinchInitialScreenDist / sizeRatio, 0.55, 3.5);
                }

                const dirFromCam = targetPos.clone().sub(camWorldPos).normalize();
                const finalPos = camWorldPos.clone().addScaledVector(dirFromCam, desiredDist);

                pinchedScreen.position.lerp(finalPos, 0.38);
                pinchedScreen.lookAt(camWorldPos);
                syncCSS3DObject(pinchedScreen);
            }
            wasPinching = isPinching;
            return;
        } else {
            pinchedScreen.userData.originalPosition = pinchedScreen.position.clone();
            syncCSS3DObject(pinchedScreen);
            pinchedScreen = null;
        }
    }

    // 2. Check intersection with Control Panel & Screen buttons
    const buttons = _getInteractiveButtons();
    _handRaycaster.params.Mesh.threshold = 0.035;
    const hits = buttons.length > 0 ? _handRaycaster.intersectObjects(buttons, true) : [];

    if (hits.length > 0) {
        const hit = hits[0];
        const btn = _findParentButton(hit.object);

        if (is3DRay && _cursorGroup3D) {
            _cursorGroup3D.visible = true;
            _cursorGroup3D.position.copy(hit.point);
            if (cam) {
                const camWorldPos = new THREE.Vector3();
                cam.getWorldPosition(camWorldPos);
                _cursorGroup3D.lookAt(camWorldPos);
            }
            if (_laserLine3D && rayOrigin) {
                _updateLaserLine(rayOrigin, hit.point);
            }
        }

        if (btn) {
            if (hoveredButton !== btn) {
                _clearHoveredButton();
                hoveredButton = btn;
                hoverStartTime = now;
                if (btn.material && btn.userData.hoverColor) {
                    btn.material.color.copy(btn.userData.hoverColor);
                }
                btn.scale.set(1.18, 1.18, 1.18);
            }

            const dwellElapsed = now - hoverStartTime;
            const dwellProgress = Math.min(1.0, dwellElapsed / DWELL_CLICK_MS);

            _updateCursorProgress(dwellProgress, btn.userData.screenType || btn.userData.action, isPinching);

            const pinchTriggered = isPinching && !wasPinching;
            const dwellTriggered = dwellProgress >= 1.0;

            if ((pinchTriggered || dwellTriggered) && (now - lastClickTime > CLICK_COOLDOWN_MS)) {
                lastClickTime = now;
                hoverStartTime = now + 500;
                _triggerButtonByHand(btn, pinchTriggered ? '🤏 Pinch' : '☝️ Hover');
            }

            wasPinching = isPinching;
            return;
        }
    }

    // No button hit — clear hover state
    _clearHoveredButton();
    _updateCursorProgress(0, null, isPinching);

    // 3. Check if user is pinching a screen's top bar to drag it in 3D space
    if (isPinching && !wasPinching && screens && screens.length > 0 && cam) {
        const screenHits = _handRaycaster.intersectObjects(screens, true);
        if (screenHits.length > 0) {
            const hitObj = screenHits[0].object;
            const targetScreen = (hitObj.userData && hitObj.userData.screen) ? hitObj.userData.screen : null;
            if (targetScreen) {
                selectScreen(targetScreen);
                pinchedScreen = targetScreen;
                const camWorldPos = new THREE.Vector3();
                const camWorldQuat = new THREE.Quaternion();
                cam.getWorldPosition(camWorldPos);
                cam.getWorldQuaternion(camWorldQuat);
                _pinchInitialScreenDist = THREE.MathUtils.clamp(targetScreen.position.distanceTo(camWorldPos), 0.55, 3.5);
                _pinchInitialPalmSize = _currentPalmSize;
                const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camWorldQuat);
                _pinchDragPlane.setFromNormalAndCoplanarPoint(camForward, screenHits[0].point);
                _pinchDragOffset.copy(screenHits[0].point).sub(targetScreen.position);
                createNotification('🤏 Hand Grab: Move hand to drag or pull closer/further', 'info');
            }
        }
    }

    if (is3DRay && _cursorGroup3D && rayOrigin && rayDir) {
        const endPt = rayOrigin.clone().addScaledVector(rayDir, 0.85);
        _cursorGroup3D.visible = true;
        _cursorGroup3D.position.copy(endPt);
        if (cam) {
            const camWorldPos = new THREE.Vector3();
            cam.getWorldPosition(camWorldPos);
            _cursorGroup3D.lookAt(camWorldPos);
        }
        _updateLaserLine(rayOrigin, endPt);
    }

    wasPinching = isPinching;
}

function _clearHoveredButton() {
    if (hoveredButton) {
        if (hoveredButton.material && hoveredButton.userData.originalColor) {
            hoveredButton.material.color.copy(hoveredButton.userData.originalColor);
        }
        hoveredButton.scale.set(1, 1, 1);
        hoveredButton = null;
    }
    hoverStartTime = 0;
}

function _triggerButtonByHand(button, methodLabel = '🖐️ Hand') {
    if (!button || !button.userData) return;

    const action = button.userData.action;
    const screenType = button.userData.screenType;

    if (navigator.vibrate) {
        navigator.vibrate([35, 25, 50]);
    }

    button.scale.set(1.3, 1.3, 1.3);
    setTimeout(() => {
        if (button) button.scale.set(1, 1, 1);
    }, 180);

    if (action === 'selectScreenType' && screenType) {
        const cam = _camera || window.__arCamera;
        let screenPos = new THREE.Vector3(0, 0, -1.5);
        const camWorldPos = new THREE.Vector3();
        const camWorldQuat = new THREE.Quaternion();
        if (cam) {
            cam.updateMatrixWorld(true);
            cam.getWorldPosition(camWorldPos);
            cam.getWorldQuaternion(camWorldQuat);
            const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camWorldQuat);
            screenPos = camWorldPos.clone().add(camDir.multiplyScalar(1.5));
        }

        const created = createScreenFromButton(screenType, screenPos);
        if (created && cam) {
            created.lookAt(camWorldPos);
        }

        spawnPanelAtCamera(false);
        const niceName = screenType.charAt(0).toUpperCase() + screenType.slice(1);
        createNotification(`${methodLabel}: Opened ${niceName}`, 'success');
    } else if (action === 'deleteScreen' || action === 'closeAllScreens') {
        if (screens && screens.length > 0) {
            while (screens.length > 0) {
                removeScreen(screens[screens.length - 1]);
            }
            createNotification(`${methodLabel}: Closed All Screens`, 'info');
        } else {
            createNotification('No Screens Open', 'info');
        }
        spawnPanelAtCamera(false);
    } else if (action === 'addScreen' || action === 'newScreen') {
        createScreenFromButton('browser');
        spawnPanelAtCamera(false);
        createNotification(`${methodLabel}: Opened Browser`, 'success');
    }

    _clearHoveredButton();
}

// ─── MediaPipe Hands Camera Engine (Laptop, Desktop & Mobile Phone) ──────────

async function _initMediaPipeModel() {
    if (_mpHandLandmarker) return _mpHandLandmarker;

    const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const { FilesetResolver, HandLandmarker } = visionModule;

    const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    // Always try GPU delegate first (5ms on mobile GPU vs 140ms main-thread freeze on CPU WASM!)
    try {
        _mpHandLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45
        });
        console.log('[hands] MediaPipe HandLandmarker loaded with GPU delegate.');
    } catch (err) {
        console.warn('[hands] GPU delegate failed, falling back to CPU:', err);
        _mpHandLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45
        });
    }

    return _mpHandLandmarker;
}

/**
 * Waits until a <video> element actually decodes non-zero pixel dimensions,
 * and verifies that drawing it onto a 2D canvas doesn't produce a black/dead frame.
 */
async function _waitForLiveVideoFrames(videoEl, timeoutMs = 1800) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0 && !videoEl.paused && !videoEl.ended) {
            return true;
        }
        await new Promise(r => setTimeout(r, 80));
    }
    return videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
}

async function _acquireCameraStream(preferredFacing) {
    const isInAR = _renderer && _renderer.xr && _renderer.xr.isPresenting;

    // Stop any previous tracks BEFORE requesting a new camera — Android phones fail if two tracks overlap!
    if (_mpStream) {
        _mpStream.getTracks().forEach(t => t.stop());
        _mpStream = null;
    }
    if (_camVideo && _camVideo.srcObject) {
        _camVideo.srcObject = null;
    }

    // Build fallback list with 4:3 sensor aspect ratio (640x480) so mobile portrait streams aren't super-tall 9:20 strips:
    const fallbacks = preferredFacing === 'environment'
        ? [
            { video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false },
            { video: { facingMode: 'environment' }, audio: false },
            { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
            { video: true, audio: false }
        ]
        : [
            { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false },
            { video: { facingMode: 'user' }, audio: false },
            { video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
            { video: true, audio: false }
        ];

    let lastErr = null;
    for (const constraints of fallbacks) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = stream.getVideoTracks()[0];
            if (!track || track.readyState === 'ended') {
                stream.getTracks().forEach(t => t.stop());
                continue;
            }

            _camVideo.srcObject = stream;
            await _camVideo.play();

            // Wait up to 3.5 seconds for Android mobile camera hardware warm-up
            const hasFrames = await _waitForLiveVideoFrames(_camVideo, 3500);
            if (!hasFrames && isInAR) {
                console.warn('[hands] Camera stream produced 0x0 frames in AR mode, trying fallback camera...');
                stream.getTracks().forEach(t => t.stop());
                _camVideo.srcObject = null;
                continue;
            }

            if (track.getSettings) {
                const settings = track.getSettings();
                if (settings.facingMode) {
                    _mpFacingMode = settings.facingMode;
                } else if (constraints.video && constraints.video.facingMode) {
                    _mpFacingMode = constraints.video.facingMode;
                }
            }
            return stream;
        } catch (err) {
            lastErr = err;
            console.warn('[hands] Camera constraint attempt failed:', constraints, err.name);
        }
    }
    throw lastErr || new Error('Could not open a live camera stream');
}

// Live Camera Passthrough Background (for Mobile Hand-Cam AR mode when WebXR is not locking the camera)
let _passthroughVideo   = null;
let _gyroListenerActive = false;
let _initialAlpha       = null;
const _ze               = new THREE.Vector3(0, 0, 1);
const _euler            = new THREE.Euler();
const _q0               = new THREE.Quaternion();
const _q1               = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

function _enableLiveCameraARBackground(stream) {
    if (!_passthroughVideo) {
        _passthroughVideo = document.createElement('video');
        _passthroughVideo.id = 'handArPassthroughBg';
        _passthroughVideo.playsInline = true;
        _passthroughVideo.autoplay = true;
        _passthroughVideo.muted = true;
        _passthroughVideo.setAttribute('playsinline', '');
        _passthroughVideo.setAttribute('webkit-playsinline', '');
        _passthroughVideo.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            object-fit: cover;
            z-index: -1;
            pointer-events: none;
            display: none;
        `;
        document.body.insertBefore(_passthroughVideo, document.body.firstChild);
    }

    // Only show full-screen passthrough when not inside an ARCore WebXR session
    const isInAR = _renderer && _renderer.xr && _renderer.xr.isPresenting;
    if (!isInAR && stream) {
        _passthroughVideo.srcObject = stream;
        _passthroughVideo.style.transform = _mpFacingMode === 'user' ? 'scaleX(-1)' : 'none';
        _passthroughVideo.style.display = 'block';
        _passthroughVideo.play().catch(() => {});
        _enableGyroCameraTracking();
    }
}

function _disableLiveCameraARBackground() {
    if (_passthroughVideo) {
        _passthroughVideo.srcObject = null;
        _passthroughVideo.style.display = 'none';
    }
}

function _enableGyroCameraTracking() {
    if (_gyroListenerActive || !isMobileDevice) return;

    const attachListeners = () => {
        if (_gyroListenerActive) return;
        _gyroListenerActive = true;

        const onOrientation = (e) => {
            if (!_mpActive || (_renderer && _renderer.xr && _renderer.xr.isPresenting)) return;
            if (e.alpha === null && e.beta === null && e.gamma === null) return;

            const cam = _camera || window.__arCamera;
            if (!cam) return;

            const rawAlpha = e.alpha || 0;
            if (_initialAlpha === null) _initialAlpha = rawAlpha;

            const alpha = THREE.MathUtils.degToRad(rawAlpha - _initialAlpha);
            const beta  = THREE.MathUtils.degToRad(e.beta  || 0);
            const gamma = THREE.MathUtils.degToRad(e.gamma || 0);
            const orientAngle = (window.screen && window.screen.orientation && window.screen.orientation.angle !== undefined)
                ? window.screen.orientation.angle
                : (window.orientation || 0);
            const orient = THREE.MathUtils.degToRad(orientAngle);

            _euler.set(beta, alpha, -gamma, 'YXZ');
            cam.quaternion.setFromEuler(_euler);
            cam.quaternion.multiply(_q1);
            cam.quaternion.multiply(_q0.setFromAxisAngle(_ze, -orient));
            cam.updateMatrixWorld(true);
        };

        window.addEventListener('deviceorientation', onOrientation, true);
        window.addEventListener('deviceorientationabsolute', onOrientation, true);

        // Also allow 1-finger background touch-look panning when in Hand-Cam mode so user can look around freely
        let lookTouchActive = false;
        let lastLookX = 0;
        let lastLookY = 0;
        let manualYaw = 0;
        let manualPitch = 0;

        window.addEventListener('touchstart', (e) => {
            if (!_mpActive || (_renderer && _renderer.xr && _renderer.xr.isPresenting)) return;
            if (e.touches.length === 1 && e.target === (_renderer && _renderer.domElement)) {
                lookTouchActive = true;
                lastLookX = e.touches[0].clientX;
                lastLookY = e.touches[0].clientY;
            }
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (!lookTouchActive || !_mpActive || (_renderer && _renderer.xr && _renderer.xr.isPresenting)) return;
            if (_initialAlpha !== null) return; // Only use touch-look fallback if gyro hasn't fired
            const cam = _camera || window.__arCamera;
            if (!cam || !e.touches[0]) return;
            const dx = e.touches[0].clientX - lastLookX;
            const dy = e.touches[0].clientY - lastLookY;
            lastLookX = e.touches[0].clientX;
            lastLookY = e.touches[0].clientY;
            manualYaw   += dx * 0.004;
            manualPitch  = THREE.MathUtils.clamp(manualPitch + dy * 0.004, -1.2, 1.2);
            _euler.set(manualPitch, manualYaw, 0, 'YXZ');
            cam.quaternion.setFromEuler(_euler);
            cam.updateMatrixWorld(true);
        }, { passive: true });

        window.addEventListener('touchend', () => { lookTouchActive = false; }, { passive: true });
    };

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(state => {
            if (state === 'granted') attachListeners();
        }).catch(() => attachListeners());
    } else {
        attachListeners();
    }
}

async function _toggleHandCamera() {
    // Clean up startup preview stream if it's still running
    if (_startupPreviewStream) {
        _startupPreviewStream.getTracks().forEach(t => t.stop());
        _startupPreviewStream = null;
        _startupPreviewStopped = true;
    }

    if (_mpActive) {
        _stopHandCamera();
        return;
    }

    if (_mpLoading) return;
    _mpLoading = true;
    _updateCamButtonState('⏳ Opening Cam...');

    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        _mpLoading = false;
        _updateCamButtonState('📷 Hand Cam');
        createNotification('⚠️ Mobile camera requires HTTPS (e.g. GitHub Pages URL).', 'error');
        return;
    }

    try {
        // Show the preview box BEFORE attaching stream so mobile browsers decode frames immediately
        _camPreviewBox.style.display = 'flex';
        if (_gestureBadge) _gestureBadge.textContent = '📷 Requesting Camera...';

        // 1. If currently inside an ARCore WebXR session:
        //    NEVER call session.end() automatically! Keep the user inside true 6DoF ARCore so AR never stops!
        if (_renderer && _renderer.xr && _renderer.xr.isPresenting) {
            // Try WebXR Raw Camera Access (`view.camera`) first on the next render frame,
            // and also attempt to open a secondary camera stream if the device supports concurrent streams.
            console.log('[hands] Staying inside 6DoF ARCore session — enabling WebXR camera-access / concurrent stream...');
            _usingXrCamera = true;
        } else {
            // 2. Not in ARCore — call getUserMedia() inside the user's click event
            _mpStream = await _acquireCameraStream(_mpFacingMode);
            _usingXrCamera = false;
        }

        _camCanvas.width  = 160;
        _camCanvas.height = 120;

        // On mobile phones outside ARCore, display the live camera feed as full-screen background + enable 3DoF Gyro
        if (isMobileDevice && _mpStream && !_usingXrCamera) {
            _enableLiveCameraARBackground(_mpStream);
        }

        // 3. Now that camera stream is open and playing, download/init MediaPipe HandLandmarker AI
        if (_gestureBadge) _gestureBadge.textContent = '⏳ Loading Hand AI...';
        _updateCamButtonState('⏳ Loading AI...');
        await _initMediaPipeModel();

        if (!_feedCanvas) {
            _feedCanvas = document.createElement('canvas');
            _feedCtx = _feedCanvas.getContext('2d', { willReadFrequently: true });
        }

        _mpActive  = true;
        _mpLoading = false;
        const camLabel = _mpFacingMode === 'environment' ? 'Rear' : 'Front';
        _updateCamButtonState(`📷 Hand (${camLabel})`, true);
        if (_gestureBadge) _gestureBadge.textContent = `Show hand (${camLabel})...`;
        createNotification(`🖐️ Hand Cam (${camLabel}) Active! Show Open Palm for Menu, Point/Pinch to Open App.`, 'success');
    } catch (err) {
        console.warn('[hands] MediaPipe Hand Cam error:', err);
        _mpLoading = false;
        _mpActive  = false;
        if (_camPreviewBox) _camPreviewBox.style.display = 'none';
        _updateCamButtonState('📷 Hand Cam');
        createNotification(`Camera error: ${err.message || err.name}. Tap 🔒 in address bar to allow Camera.`, 'warning');
    }
}

function _stopHandCamera() {
    _mpActive = false;
    _usingXrCamera = false;
    _disableLiveCameraARBackground();
    if (_mpStream) {
        _mpStream.getTracks().forEach(t => t.stop());
        _mpStream = null;
    }
    if (_camVideo) {
        _camVideo.srcObject = null;
    }
    if (_camPreviewBox) _camPreviewBox.style.display = 'none';
    if (_domCursor) _domCursor.style.display = 'none';
    _clearHoveredButton();
    _updateCamButtonState('📷 Hand Cam', false);
}

async function _flipHandCamera() {
    const nextFacing = _mpFacingMode === 'user' ? 'environment' : 'user';
    _mpFacingMode = nextFacing;

    if (!_mpActive || _mpLoading) return;
    _mpLoading = true;
    if (_gestureBadge) _gestureBadge.textContent = `🔄 Switching to ${nextFacing === 'environment' ? 'Rear' : 'Front'}...`;

    // Case 1: User flipped to Rear ('environment') while inside a 6DoF ARCore session with camera-access enabled
    const isInAR = _renderer && _renderer.xr && _renderer.xr.isPresenting;
    if (isInAR && nextFacing === 'environment') {
        const session = _renderer.xr.getSession();
        const hasXrCam = session && session.enabledFeatures && session.enabledFeatures.includes('camera-access');
        if (hasXrCam) {
            if (_mpStream) {
                _mpStream.getTracks().forEach(t => t.stop());
                _mpStream = null;
            }
            if (_camVideo) {
                _camVideo.srcObject = null;
                _camVideo.style.display = 'none';
            }
            _usingXrCamera = true;
            _mpLoading = false;
            _updateCamButtonState('📷 Hand (Rear)', true);
            if (_gestureBadge) _gestureBadge.textContent = 'Show hand (Rear)...';
            return;
        }
    }

    // Case 2: Switch via getUserMedia (either Front cam inside AR, or Front <-> Rear outside ARCore)
    try {
        // Release old camera tracks first and give Android hardware 150ms to free the camera device
        if (_mpStream) {
            _mpStream.getTracks().forEach(t => t.stop());
            _mpStream = null;
        }
        if (_camVideo) {
            _camVideo.srcObject = null;
            _camVideo.style.display = 'block';
        }
        await new Promise(r => setTimeout(r, 150));

        _mpStream = await _acquireCameraStream(nextFacing);
        _usingXrCamera = false;

        if (isMobileDevice && !isInAR) {
            _enableLiveCameraARBackground(_mpStream);
        }

        _mpLoading = false;
        const camLabel = _mpFacingMode === 'environment' ? 'Rear' : 'Front';
        _updateCamButtonState(`📷 Hand (${camLabel})`, true);
        if (_gestureBadge) _gestureBadge.textContent = `Show hand (${camLabel})...`;
    } catch (err) {
        console.warn('[hands] Flip camera error:', err);
        _mpLoading = false;
        if (_gestureBadge) _gestureBadge.textContent = 'Flip unavailable in ARCore';
    }
}

/**
 * Extracts a crisp, properly oriented 2D canvas frame directly from WebXR's raw ARCore camera texture (`view.camera`).
 * Preserves the phone's true portrait/landscape aspect ratio and uses 480p resolution for sharp hand detection!
 */
let _xrDownsampleFbo  = null;
let _xrDownsampleTex  = null;
let _xrLastDstW       = 0;
let _xrLastDstH       = 0;
let _xrPixelBuf       = null;
let _xrRotateCanvas   = null;
let _xrRotateCtx      = null;

function _captureWebXRCameraFrame(frame) {
    if (!frame || !_renderer || !_renderer.xr) return null;
    const session  = _renderer.xr.getSession();
    const refSpace = _renderer.xr.getReferenceSpace();
    if (!session || !refSpace || typeof XRWebGLBinding === 'undefined') return null;

    const viewerPose = frame.getViewerPose(refSpace);
    if (!viewerPose || !viewerPose.views) return null;

    for (const view of viewerPose.views) {
        if (!view.camera) continue;
        try {
            const gl = _renderer.getContext();
            if (!_xrGlBinding) {
                _xrGlBinding = new XRWebGLBinding(session, gl);
            }
            const camTex = _xrGlBinding.getCameraImage(view.camera);
            if (!camTex) continue;

            const srcW = view.camera.width;
            const srcH = view.camera.height;
            if (!srcW || !srcH) continue;

            // Preserve the exact aspect ratio of the ARCore camera texture at ~480px on the long edge
            // (2x higher resolution than before -> 4x more detail for MediaPipe hand detection!)
            const scale = Math.min(1.0, 480 / Math.max(srcW, srcH));
            const dstW  = Math.max(64, Math.round(srcW * scale));
            const dstH  = Math.max(64, Math.round(srcH * scale));

            if (!_xrCaptureCanvas) {
                _xrCaptureCanvas = document.createElement('canvas');
                _xrCaptureCtx = _xrCaptureCanvas.getContext('2d');
            }
            _xrCaptureCanvas.width  = dstW;
            _xrCaptureCanvas.height = dstH;

            const prevFbo      = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            const prevReadFbo  = gl.READ_FRAMEBUFFER ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null;
            const prevDrawFbo  = gl.DRAW_FRAMEBUFFER ? gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) : null;
            const prevTex      = gl.getParameter(gl.TEXTURE_BINDING_2D);

            if (!_xrReadFbo) _xrReadFbo = gl.createFramebuffer();

            if (gl.blitFramebuffer) {
                if (!_xrDownsampleFbo || _xrLastDstW !== dstW || _xrLastDstH !== dstH) {
                    if (!_xrDownsampleFbo) _xrDownsampleFbo = gl.createFramebuffer();
                    if (!_xrDownsampleTex) _xrDownsampleTex = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, _xrDownsampleTex);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, dstW, dstH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, _xrDownsampleFbo);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _xrDownsampleTex, 0);
                    _xrLastDstW = dstW;
                    _xrLastDstH = dstH;
                    _xrPixelBuf = new Uint8Array(dstW * dstH * 4);
                }

                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, _xrReadFbo);
                gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, camTex, 0);

                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, _xrDownsampleFbo);
                // Flip Y during blit (srcY0=srcH -> srcY1=0) so WebGL bottom-left origin becomes Canvas top-left origin
                gl.blitFramebuffer(0, srcH, srcW, 0, 0, 0, dstW, dstH, gl.COLOR_BUFFER_BIT, gl.LINEAR);

                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, _xrDownsampleFbo);
                gl.readPixels(0, 0, dstW, dstH, gl.RGBA, gl.UNSIGNED_BYTE, _xrPixelBuf);

                // Restore Three.js WebGL2 state cleanly
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFbo);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDrawFbo);
                gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
                gl.bindTexture(gl.TEXTURE_2D, prevTex);

                const imgData = _xrCaptureCtx.createImageData(dstW, dstH);
                imgData.data.set(_xrPixelBuf);
                _xrCaptureCtx.putImageData(imgData, 0, 0);

                // Note: In Chrome Android WebXR, view.camera is ALREADY oriented to match the display viewport!
                // If the ARCore texture is taller than 3:4 (e.g. full 9:20 phone display aspect), center-crop vertically
                // to a clean 3:4 portrait window so the preview box isn't an ultra-tall vertical strip!
                if (dstH > dstW * 1.35) {
                    const cropH = Math.round(dstW * 1.25); // Clean 4:5 / 3:4 compact portrait ratio
                    const cropY = Math.round((dstH - cropH) * 0.5);
                    if (!_xrRotateCanvas) {
                        _xrRotateCanvas = document.createElement('canvas');
                        _xrRotateCtx = _xrRotateCanvas.getContext('2d');
                    }
                    _xrRotateCanvas.width  = dstW;
                    _xrRotateCanvas.height = cropH;
                    _xrRotateCtx.drawImage(_xrCaptureCanvas, 0, cropY, dstW, cropH, 0, 0, dstW, cropH);
                    return _xrRotateCanvas;
                }

                return _xrCaptureCanvas;
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
            gl.bindTexture(gl.TEXTURE_2D, prevTex);
        } catch (e) {
            return null;
        }
    }
    return null;
}

// Helper to keep the mini camera preview box at a clean, compact 4:3 / 4:5 proportion (never ultra-tall!)
let _videoWrapEl = null;
function _syncPreviewAspectRatio(srcW, srcH) {
    if (!srcW || !srcH || !_videoWrapEl || !_camPreviewBox) return;
    const isPortraitVideo = srcH > srcW;
    const boxW = isPortraitVideo ? 115 : 135;
    // Cap maximum height ratio at 1.25x width (4:5 portrait) so it never becomes a super-tall 9:20 strip
    const clampedRatio = Math.min(1.25, Math.max(0.75, srcH / srcW));
    const boxH = Math.round(boxW * clampedRatio);
    _camPreviewBox.style.width = `${boxW}px`;
    _videoWrapEl.style.width   = `${boxW}px`;
    _videoWrapEl.style.height  = `${boxH}px`;
}

function _updateMediaPipeHands(frame = null) {
    if (!_mpActive || !_mpHandLandmarker) return;

    const nowMs = Math.floor(performance.now());
    // Throttle inference on mobile phones (~12 FPS = every 85ms) so main thread & 60fps 3D rendering never lag!
    if (isMobileDevice && (nowMs - _lastDetectMs < 85)) return;
    if (nowMs <= _lastDetectMs) return; // MediaPipe requires strictly increasing timestamps!

    let mirror = _mpFacingMode === 'user';

    // Ensure offscreen feed canvas is ready
    if (!_feedCanvas) {
        _feedCanvas = document.createElement('canvas');
        _feedCtx = _feedCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (_usingXrCamera) {
        // Hide the unused <video> element so the ARCore canvas frame on _camCanvas is 100% visible!
        if (_camVideo && _camVideo.style.display !== 'none') {
            _camVideo.style.display = 'none';
        }
        const xrFrameCanvas = _captureWebXRCameraFrame(frame);
        mirror = false;
        if (!xrFrameCanvas) {
            // WebXR raw camera access not exposed on this device — automatically switch to front camera!
            if (_renderer && _renderer.xr && _renderer.xr.isPresenting && !_mpLoading) {
                console.log('[hands] WebXR view.camera not available — switching to Front Camera stream.');
                _usingXrCamera = false;
                _mpFacingMode = 'user';
                if (_camVideo) _camVideo.style.display = 'block';
                _acquireCameraStream('user').then(stream => {
                    _mpStream = stream;
                    _updateCamButtonState('📷 Hand (Front)', true);
                }).catch(() => {
                    if (_gestureBadge) _gestureBadge.textContent = 'Enable chrome://flags/#webxr-incubations';
                });
            }
            return;
        }

        // Sync preview container aspect ratio to match ARCore camera frame so it never stretches!
        _syncPreviewAspectRatio(xrFrameCanvas.width, xrFrameCanvas.height);

        _feedCanvas = xrFrameCanvas;
        _camCanvas.width  = xrFrameCanvas.width;
        _camCanvas.height = xrFrameCanvas.height;
        _camCtx.clearRect(0, 0, _camCanvas.width, _camCanvas.height);
        _camCtx.drawImage(xrFrameCanvas, 0, 0, _camCanvas.width, _camCanvas.height);
    } else {
        if (_camVideo && _camVideo.style.display === 'none') {
            _camVideo.style.display = 'block';
        }
        if (!_camVideo || _camVideo.readyState < 2 || _camVideo.videoWidth === 0) {
            if (_camVideo && _camVideo.paused) {
                _camVideo.play().catch(() => {});
            }
            return;
        }

        // Mirror the visible <video> element if using front selfie camera
        _camVideo.style.transform = mirror ? 'scaleX(-1)' : 'none';

        // Match preview box and overlay canvas dimensions to the EXACT camera video aspect ratio so it never stretches!
        const vw = _camVideo.videoWidth;
        const vh = _camVideo.videoHeight;
        _syncPreviewAspectRatio(vw, vh);

        const previewScale = Math.min(1.0, 240 / Math.max(vw, vh));
        _camCanvas.width  = Math.round(vw * previewScale);
        _camCanvas.height = Math.round(vh * previewScale);
        _camCtx.clearRect(0, 0, _camCanvas.width, _camCanvas.height);
    }

    _lastDetectMs = nowMs;
    _mpDetectCounter++;

    // Run MediaPipe HandLandmarker (pass _camVideo directly on GPU when not using XR camera for zero-copy speed!)
    let results;
    try {
        const detectTarget = _usingXrCamera ? _feedCanvas : _camVideo;
        results = _mpHandLandmarker.detectForVideo(detectTarget, nowMs);
    } catch (e) {
        try {
            results = _mpHandLandmarker.detectForVideo(_feedCanvas, nowMs + 1);
        } catch (e2) {
            return;
        }
    }

    if (!results || !results.landmarks || results.landmarks.length === 0) {
        if (_domCursor) _domCursor.style.display = 'none';
        if (_gestureBadge) {
            const camName = _usingXrCamera ? 'AR' : (_mpFacingMode === 'environment' ? 'Rear' : 'Front');
            _gestureBadge.textContent = `Scanning (${camName} Cam)...`;
            _gestureBadge.style.color = '#94a3b8';
        }
        _clearHoveredButton();
        openPalmStartTime = 0;
        fistStartTime = 0;
        return;
    }

    const lm = results.landmarks[0]; // 21 3D landmarks normalized [0..1]

    // Draw glowing hand skeleton on top of the live camera image in the mini preview canvas
    _drawMiniHandSkeleton(lm, mirror);

    // Analyze 21 landmarks for gestures
    const gestureInfo = _classifyMediaPipeHand(lm);

    // Update live gesture badge
    if (_gestureBadge) {
        _gestureBadge.textContent = gestureInfo.label;
        _gestureBadge.style.color = gestureInfo.isPinching ? '#00ff88' : '#00e5ff';
    }

    // 1. Open Palm (5 extended fingers) → Summon Control Panel
    if (gestureInfo.isOpenPalm && !gestureInfo.isPinching) {
        fistStartTime = 0;
        if (!panelVisible && (nowMs - lastGestureTime > GESTURE_COOLDOWN_MS)) {
            if (openPalmStartTime === 0) openPalmStartTime = nowMs;
            if (nowMs - openPalmStartTime >= OPEN_PALM_HOLD_MS) {
                spawnPanelAtCamera(true);
                createNotification('🖐️ Open Palm: Control Panel Opened!', 'info');
                openPalmStartTime = 0;
                lastGestureTime = nowMs;
            }
        }
    } else {
        openPalmStartTime = 0;
    }

    // 2. Closed Fist (0 extended fingers) → Dismiss Control Panel
    if (gestureInfo.isFist && !gestureInfo.isPinching) {
        if (panelVisible && (nowMs - lastGestureTime > GESTURE_COOLDOWN_MS)) {
            if (fistStartTime === 0) fistStartTime = nowMs;
            if (nowMs - fistStartTime >= FIST_HOLD_MS) {
                spawnPanelAtCamera(false);
                createNotification('✊ Fist: Control Panel Closed', 'info');
                fistStartTime = 0;
                lastGestureTime = nowMs;
            }
        }
    } else {
        fistStartTime = 0;
    }

    // 3. Map Index Finger Tip (landmark 8) to Screen Cursor & 3D Raycaster
    const rawX = mirror ? (1.0 - lm[8].x) : lm[8].x;
    const rawY = lm[8].y;

    // Remap comfortable active camera zone [0.12..0.88] to full screen [0..1]
    const mappedX = THREE.MathUtils.clamp((rawX - 0.12) / 0.76, 0, 1);
    const mappedY = THREE.MathUtils.clamp((rawY - 0.12) / 0.76, 0, 1);

    const targetNdcX = mappedX * 2 - 1;
    const targetNdcY = -(mappedY * 2 - 1);

    // Smooth cursor motion
    _smoothedNdc.x = THREE.MathUtils.lerp(_smoothedNdc.x, targetNdcX, 0.42);
    _smoothedNdc.y = THREE.MathUtils.lerp(_smoothedNdc.y, targetNdcY, 0.42);

    const screenX = ((_smoothedNdc.x + 1) * 0.5) * window.innerWidth;
    const screenY = ((-_smoothedNdc.y + 1) * 0.5) * window.innerHeight;

    // Position glowing DOM virtual hand cursor
    if (_domCursor) {
        _domCursor.style.display = 'flex';
        _domCursor.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
    }

    // Raycast from camera through smoothed hand cursor into Three.js scene
    const cam = _camera || window.__arCamera;
    if (cam) {
        cam.updateMatrixWorld(true);
        _handRaycaster.setFromCamera(_smoothedNdc, cam);
        _processRayInteraction(gestureInfo.isPinching, false);
    }
}

function _classifyMediaPipeHand(lm) {
    const dist2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const palmSize = Math.max(0.05, dist2D(lm[0], lm[9]));
    _currentPalmSize = THREE.MathUtils.lerp(_currentPalmSize, palmSize, 0.35);

    // Pinch distance between thumb tip (4) and index tip (8) normalized by palm size
    const pinchDist = dist2D(lm[4], lm[8]) / palmSize;
    const isPinching = pinchDist < 0.36;

    // Finger extension checks (stricter extension ratio so casual hand movements don't false-trigger Open Palm)
    const indexExt  = dist2D(lm[8],  lm[0]) > dist2D(lm[6],  lm[0]) * 1.16;
    const middleExt = dist2D(lm[12], lm[0]) > dist2D(lm[10], lm[0]) * 1.16;
    const ringExt   = dist2D(lm[16], lm[0]) > dist2D(lm[14], lm[0]) * 1.15;
    const pinkyExt  = dist2D(lm[20], lm[0]) > dist2D(lm[18], lm[0]) * 1.14;
    const thumbExt  = dist2D(lm[4],  lm[17]) > palmSize * 0.96;

    const extendedCount = (indexExt ? 1 : 0) + (middleExt ? 1 : 0) + (ringExt ? 1 : 0) + (pinkyExt ? 1 : 0) + (thumbExt ? 1 : 0);

    // Require all 5 fingers clearly spread open for Open Palm so pointing/moving hand doesn't accidentally summon menu!
    const isOpenPalm = (extendedCount === 5) && !isPinching;
    const isFist     = !indexExt && !middleExt && !ringExt && !pinkyExt && !isPinching;

    let label = '☝️ Pointing';
    if (isPinching)      label = '🤏 Pinch';
    else if (isOpenPalm) label = '🖐️ Open Palm';
    else if (isFist)     label = '✊ Fist';

    return { isPinching, isOpenPalm, isFist, indexExt, label };
}

function _drawMiniHandSkeleton(lm, mirror) {
    if (!_camCtx || !_camCanvas) return;
    const w = _camCanvas.width;
    const h = _camCanvas.height;

    const connections = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [0,9],[9,10],[10,11],[11,12],
        [0,13],[13,14],[14,15],[15,16],
        [0,17],[17,18],[18,19],[19,20],
        [5,9],[9,13],[13,17]
    ];

    _camCtx.strokeStyle = '#00e5ff';
    _camCtx.lineWidth = 2;
    for (const [i, j] of connections) {
        const x1 = (mirror ? (1 - lm[i].x) : lm[i].x) * w;
        const y1 = lm[i].y * h;
        const x2 = (mirror ? (1 - lm[j].x) : lm[j].x) * w;
        const y2 = lm[j].y * h;
        _camCtx.beginPath();
        _camCtx.moveTo(x1, y1);
        _camCtx.lineTo(x2, y2);
        _camCtx.stroke();
    }

    for (let idx = 0; idx < lm.length; idx++) {
        const x = (mirror ? (1 - lm[idx].x) : lm[idx].x) * w;
        const y = lm[idx].y * h;
        _camCtx.fillStyle = (idx === 8 || idx === 4) ? '#00ff88' : '#ffffff';
        _camCtx.beginPath();
        _camCtx.arc(x, y, (idx === 8 || idx === 4) ? 5 : 2.5, 0, Math.PI * 2);
        _camCtx.fill();
    }
}

// ─── WebXR Native XRHand Gesture Helpers ──────────────────────────────────────

function _detectOpenPalmXR(frame, refSpace, hand) {
    const SPREAD = 0.07;
    _palmCenter.set(0, 0, 0);
    let count = 0;

    for (const name of PALM_BASE_JOINTS) {
        const joint = hand.get(name);
        if (!joint) continue;
        const pose = frame.getJointPose(joint, refSpace);
        if (!pose) continue;
        const p = pose.transform.position;
        _palmCenter.x += p.x;
        _palmCenter.y += p.y;
        _palmCenter.z += p.z;
        count++;
    }

    if (count < 3) return { detected: false };
    _palmCenter.divideScalar(count);

    let spread = 0;
    for (const name of FINGERTIPS) {
        const joint = hand.get(name);
        if (!joint) continue;
        const pose = frame.getJointPose(joint, refSpace);
        if (!pose) continue;
        const p = pose.transform.position;
        _tipPos.set(p.x, p.y, p.z);
        if (_tipPos.distanceTo(_palmCenter) > SPREAD) spread++;
    }

    if (spread < 4) return { detected: false };

    const camPos = new THREE.Vector3();
    if (_camera) _camera.getWorldPosition(camPos);
    const normal = new THREE.Vector3().subVectors(camPos, _palmCenter).normalize();

    return { detected: true, position: _palmCenter.clone(), normal };
}

function _detectFistXR(frame, refSpace, hand) {
    const CLOSED = 0.055;
    const wrist = hand.get('wrist');
    if (!wrist) return false;
    const wristPose = frame.getJointPose(wrist, refSpace);
    if (!wristPose) return false;

    const wp = wristPose.transform.position;
    _palmCenter.set(wp.x, wp.y, wp.z);

    let closed = 0;
    for (const name of FINGERTIPS) {
        const joint = hand.get(name);
        if (!joint) continue;
        const pose = frame.getJointPose(joint, refSpace);
        if (!pose) continue;
        const p = pose.transform.position;
        _tipPos.set(p.x, p.y, p.z);
        if (_tipPos.distanceTo(_palmCenter) < CLOSED) closed++;
    }

    return closed >= 4;
}

function _detectPointAndPinchXR(frame, refSpace, hand) {
    const indexTipJoint  = hand.get('index-finger-tip');
    const indexBaseJoint = hand.get('index-finger-phalanx-proximal') || hand.get('index-finger-metacarpal');
    const thumbTipJoint  = hand.get('thumb-tip');

    if (!indexTipJoint || !indexBaseJoint) return { valid: false };

    const tipPose  = frame.getJointPose(indexTipJoint, refSpace);
    const basePose = frame.getJointPose(indexBaseJoint, refSpace);
    if (!tipPose || !basePose) return { valid: false };

    _tipPos.set(tipPose.transform.position.x, tipPose.transform.position.y, tipPose.transform.position.z);
    _indexBasePos.set(basePose.transform.position.x, basePose.transform.position.y, basePose.transform.position.z);

    _rayDir.subVectors(_tipPos, _indexBasePos).normalize();

    let isPinching = false;
    if (thumbTipJoint) {
        const thumbPose = frame.getJointPose(thumbTipJoint, refSpace);
        if (thumbPose) {
            _thumbPos.set(thumbPose.transform.position.x, thumbPose.transform.position.y, thumbPose.transform.position.z);
            isPinching = _tipPos.distanceTo(_thumbPos) < 0.028;
        }
    }

    return {
        valid: true,
        origin: _tipPos.clone(),
        direction: _rayDir.clone(),
        indexTip: _tipPos.clone(),
        isPinching
    };
}

// ─── 3D & DOM Visual Overlays ─────────────────────────────────────────────────

function _setup3DCursor(scene) {
    _cursorGroup3D = new THREE.Group();
    _cursorGroup3D.visible = false;

    const dotGeo = new THREE.CircleGeometry(0.008, 24);
    const dotMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.95
    });
    const dotMesh = new THREE.Mesh(dotGeo, dotMat);
    dotMesh.renderOrder = 3000;
    _cursorGroup3D.add(dotMesh);

    const ringGeo = new THREE.RingGeometry(0.013, 0.017, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.85
    });
    _cursorRing3D = new THREE.Mesh(ringGeo, ringMat);
    _cursorRing3D.renderOrder = 3001;
    _cursorGroup3D.add(_cursorRing3D);

    scene.add(_cursorGroup3D);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -0.5)]);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.45
    });
    _laserLine3D = new THREE.Line(lineGeo, lineMat);
    _laserLine3D.visible = false;
    _laserLine3D.renderOrder = 2999;
    scene.add(_laserLine3D);
}

function _updateLaserLine(startVec, endVec) {
    if (!_laserLine3D) return;
    _laserLine3D.visible = true;
    const pos = _laserLine3D.geometry.attributes.position;
    pos.setXYZ(0, startVec.x, startVec.y, startVec.z);
    pos.setXYZ(1, endVec.x, endVec.y, endVec.z);
    pos.needsUpdate = true;
}

function _updateCursorProgress(progress, targetName, isPinching) {
    if (_domCursor && _domCursorRing && _domCursorLabel) {
        const scale = isPinching ? 0.75 : (1.0 + progress * 0.35);
        _domCursorRing.style.transform = `scale(${scale})`;
        _domCursorRing.style.borderColor = isPinching ? '#00ff88' : (progress > 0 ? '#00ff88' : '#00e5ff');
        _domCursorRing.style.boxShadow = isPinching
            ? '0 0 18px #00ff88'
            : (progress > 0 ? `0 0 ${10 + Math.round(progress * 14)}px #00ff88` : '0 0 10px #00e5ff');

        if (targetName && progress > 0.05) {
            const pct = Math.min(100, Math.round(progress * 100));
            _domCursorLabel.style.display = 'block';
            _domCursorLabel.textContent = isPinching ? `Launching ${targetName}...` : `${targetName.toUpperCase()} (${pct}%)`;
        } else {
            _domCursorLabel.style.display = 'none';
        }
    }

    if (_cursorRing3D) {
        const s = isPinching ? 0.7 : (1.0 + progress * 0.6);
        _cursorRing3D.scale.set(s, s, 1);
    }
}

/**
 * Helper to bind tap events cleanly:
 * CRITICAL: We must bind to `click` (or `touchend`), NOT `touchstart` with `e.preventDefault()`!
 * In Mobile Chrome, calling `navigator.mediaDevices.getUserMedia()` inside a `touchstart` handler
 * does NOT count as a valid user activation gesture for permission prompts, causing Chrome to throw
 * `NotAllowedError: Permission denied`! `click` always carries full user activation.
 */
function _bindMobileSafeTap(element, handler) {
    if (!element) return;
    let lastInvoke = 0;

    // Stop touchstart from bubbling down to Three.js canvas (which calls preventDefault and would cancel the click!)
    element.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
        e.stopPropagation();
    }, { passive: true });

    element.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = performance.now();
        if (now - lastInvoke < 300) return;
        lastInvoke = now;
        handler(e);
    });
}

function _setupHUDAndOverlays() {
    const hud = document.getElementById('handControlHUD');
    if (hud) {
        // On mobile phones, hide HUD until "START AR" is pressed; on desktop/laptop, show immediately
        hud.style.display = isMobileDevice ? 'none' : 'flex';
        hud.style.gap = '7px';
        hud.style.alignItems = 'center';
        hud.style.zIndex = '10001';
    }

    const btn = document.getElementById('summonPanelBtn');
    if (btn) {
        _bindMobileSafeTap(btn, () => {
            spawnPanelAtCamera();
        });
    }

    // Add compact "📷 Hand Cam" toggle button beside the Menu pill
    if (hud && !document.getElementById('toggleHandCamBtn')) {
        _camToggleBtn = document.createElement('button');
        _camToggleBtn.id = 'toggleHandCamBtn';
        _camToggleBtn.style.cssText = `
            background: rgba(14, 22, 38, 0.92);
            color: #00e5ff;
            border: 1.5px solid #00e5ff;
            border-radius: 22px;
            padding: 7px 11px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 11px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 4px;
            box-shadow: 0 0 12px rgba(0, 229, 255, 0.35);
            backdrop-filter: blur(8px);
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            touch-action: manipulation;
        `;
        _camToggleBtn.innerHTML = '<span>📷 Hand Cam</span>';
        _bindMobileSafeTap(_camToggleBtn, () => {
            _toggleHandCamera();
        });
        hud.insertBefore(_camToggleBtn, hud.firstChild);
    }

    // Create Mini Camera Preview & Skeleton HUD (bottom-left)
    if (!document.getElementById('handCamPreviewBox')) {
        _camPreviewBox = document.createElement('div');
        _camPreviewBox.id = 'handCamPreviewBox';
        _camPreviewBox.style.cssText = `
            display: none;
            flex-direction: column;
            position: fixed;
            bottom: 80px;
            left: 12px;
            width: 120px;
            background: rgba(10, 16, 28, 0.94);
            border: 1.5px solid #00e5ff;
            border-radius: 12px;
            overflow: hidden;
            z-index: 10001;
            box-shadow: 0 0 14px rgba(0, 229, 255, 0.35);
            backdrop-filter: blur(8px);
            pointer-events: auto;
            touch-action: manipulation;
        `;

        const headerBar = document.createElement('div');
        headerBar.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 6px;
            background: rgba(0, 229, 255, 0.14);
            font-family: monospace;
            font-size: 10px;
            color: #00e5ff;
            font-weight: bold;
        `;
        headerBar.innerHTML = '<span>🖐️ HAND AI</span>';

        const flipBtn = document.createElement('button');
        flipBtn.textContent = '🔄 Flip';
        flipBtn.style.cssText = `
            background: rgba(0, 229, 255, 0.22);
            color: #fff;
            border: 1px solid #00e5ff;
            border-radius: 5px;
            padding: 1px 5px;
            font-size: 9px;
            cursor: pointer;
            touch-action: manipulation;
        `;
        _bindMobileSafeTap(flipBtn, () => {
            _flipHandCamera();
        });
        headerBar.appendChild(flipBtn);

        const videoWrap = document.createElement('div');
        videoWrap.style.cssText = 'position: relative; width: 115px; height: 135px; background: #050811; overflow: hidden;';
        _videoWrapEl = videoWrap;

        // Use object-fit: cover inside the compact 4:5 / 4:3 box so the video fills the box naturally without stretching or becoming a tall strip!
        _camVideo = document.createElement('video');
        _camVideo.playsInline = true;
        _camVideo.autoplay = true;
        _camVideo.setAttribute('playsinline', '');
        _camVideo.setAttribute('webkit-playsinline', '');
        _camVideo.setAttribute('autoplay', '');
        _camVideo.muted = true;
        _camVideo.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.88; pointer-events: none;';

        _camCanvas = document.createElement('canvas');
        _camCanvas.width = 115;
        _camCanvas.height = 135;
        _camCanvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none;';
        _camCtx = _camCanvas.getContext('2d');

        videoWrap.appendChild(_camVideo);
        videoWrap.appendChild(_camCanvas);

        _gestureBadge = document.createElement('div');
        _gestureBadge.style.cssText = `
            padding: 3px 5px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 9.5px;
            line-height: 1.15;
            font-weight: 700;
            color: #00e5ff;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            border-top: 1px solid rgba(0, 229, 255, 0.25);
        `;
        _gestureBadge.textContent = 'Show Hand...';

        _camPreviewBox.appendChild(headerBar);
        _camPreviewBox.appendChild(videoWrap);
        _camPreviewBox.appendChild(_gestureBadge);
        document.body.appendChild(_camPreviewBox);
    }

    // Create glowing Virtual Hand Cursor in DOM
    if (!document.getElementById('handVirtualCursor')) {
        _domCursor = document.createElement('div');
        _domCursor.id = 'handVirtualCursor';
        _domCursor.style.cssText = `
            display: none;
            position: fixed;
            top: -18px;
            left: -18px;
            width: 36px;
            height: 36px;
            pointer-events: none;
            z-index: 10002;
            align-items: center;
            justify-content: center;
            will-change: transform;
        `;

        _domCursorRing = document.createElement('div');
        _domCursorRing.style.cssText = `
            width: 30px;
            height: 30px;
            border: 2.5px solid #00e5ff;
            border-radius: 50%;
            box-shadow: 0 0 12px #00e5ff;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.08s ease, border-color 0.1s ease;
        `;

        const innerDot = document.createElement('div');
        innerDot.style.cssText = 'width: 7px; height: 7px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 8px #00ff88;';
        _domCursorRing.appendChild(innerDot);

        _domCursorLabel = document.createElement('div');
        _domCursorLabel.style.cssText = `
            display: none;
            position: absolute;
            top: 38px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(10, 16, 28, 0.92);
            color: #00ff88;
            border: 1px solid #00ff88;
            border-radius: 8px;
            padding: 2px 8px;
            font-family: monospace;
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap;
        `;

        _domCursor.appendChild(_domCursorRing);
        _domCursor.appendChild(_domCursorLabel);
        document.body.appendChild(_domCursor);
    }
}

function _updateCamButtonState(text, isActive = false) {
    if (!_camToggleBtn) return;
    _camToggleBtn.innerHTML = `<span>${text}</span>`;
    _camToggleBtn.style.borderColor = isActive ? '#00ff88' : '#00e5ff';
    _camToggleBtn.style.color       = isActive ? '#00ff88' : '#00e5ff';
}

function _onSessionStart() {
    // Ensure startup preview stream is released when AR session starts
    _stopStartupCameraPreview();

    if (!_renderer || !_renderer.xr) return;
    const session = _renderer.xr.getSession();
    if (!session) return;

    session.addEventListener('inputsourceschange', _onInputSourcesChange);

    // Show floating summon HUD in DOM overlay
    const hud = document.getElementById('handControlHUD');
    if (hud) hud.style.display = 'flex';

    // Start AR with a clean view (control panel closed until user taps Menu or holds Open Palm)
    spawnPanelAtCamera(false);

    // If Hand Cam was started BEFORE entering AR, ARCore may pause the rear getUserMedia stream.
    if (_mpActive) {
        setTimeout(() => {
            if (_camVideo && (_camVideo.paused || _camVideo.ended)) {
                _camVideo.play().catch(() => {
                    _stopHandCamera();
                    _toggleHandCamera();
                });
            }
        }, 900);
    }

    console.log('[hands] XR session started — clean AR space ready.');
}

function _onSessionEnd() {
    handsSupported = false;
    trackedHands.clear();
    openPalmStartTime = 0;
    fistStartTime     = 0;
    _xrGlBinding      = null;

    // Close control panel and hide cursors when stopping AR
    spawnPanelAtCamera(false);
    if (isMobileDevice) {
        const hud = document.getElementById('handControlHUD');
        if (hud) hud.style.display = 'none';
    }
    if (_cursorGroup3D) _cursorGroup3D.visible = false;
    if (_laserLine3D) _laserLine3D.visible = false;

    console.log('[hands] XR session ended.');
}

function _onInputSourcesChange(event) {
    for (const source of event.added) {
        if (source.hand) {
            handsSupported = true;
            trackedHands.set(source.handedness, source);
            console.log(`[hands] ${source.handedness} hand connected via WebXR.`);
        }
    }
    for (const source of event.removed) {
        if (source.hand) {
            trackedHands.delete(source.handedness);
        }
    }
}

// ─── Startup Camera Preview & Permission Prompt ─────────────────────────────
let _startupPreviewStream = null;
let _startupPreviewStopped = false;

function _stopStartupCameraPreview() {
    _startupPreviewStopped = true;
    if (_startupPreviewStream) {
        _startupPreviewStream.getTracks().forEach(t => t.stop());
        _startupPreviewStream = null;
    }
    if (!_mpActive) {
        if (_camVideo) _camVideo.srcObject = null;
        if (_camPreviewBox) _camPreviewBox.style.display = 'none';
    }
}

function _prewarmCameraPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

    // 1. Intercept the "START AR" button tap in the capture phase so any startup preview camera stream
    //    is immediately stopped BEFORE ARCore requests the hardware camera!
    window.addEventListener('pointerdown', (e) => {
        const target = e.target;
        if (target && (target.id === 'ARButton' || (target.closest && target.closest('#ARButton')))) {
            if (_startupPreviewStream) {
                console.log('[hands] Releasing startup camera preview before ARCore starts...');
                _stopStartupCameraPreview();
            }
        }
    }, true);

    window.addEventListener('touchstart', (e) => {
        const target = e.target;
        if (target && (target.id === 'ARButton' || (target.closest && target.closest('#ARButton')))) {
            if (_startupPreviewStream) {
                _stopStartupCameraPreview();
            }
        }
    }, { capture: true, passive: true });

    // 2. Turn on the live camera preview box right at the beginning so the browser asks for Camera permission immediately!
    const startPreview = async () => {
        if (_startupPreviewStopped || _mpActive || (_renderer && _renderer.xr && _renderer.xr.isPresenting)) return;
        try {
            if (_camPreviewBox) {
                _camPreviewBox.style.display = 'flex';
            }
            if (_gestureBadge) {
                _gestureBadge.textContent = '📷 Allowing Camera...';
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: _mpFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
            });

            // If user already tapped START AR while the permission popup was open, release immediately
            if (_startupPreviewStopped || _mpActive || (_renderer && _renderer.xr && _renderer.xr.isPresenting)) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            _startupPreviewStream = stream;
            if (_camVideo) {
                _camVideo.style.display = 'block';
                _camVideo.style.transform = _mpFacingMode === 'user' ? 'scaleX(-1)' : 'none';
                _camVideo.srcObject = stream;
                await _camVideo.play();
                if (_camVideo.videoWidth > 0 && _camVideo.videoHeight > 0) {
                    _syncPreviewAspectRatio(_camVideo.videoWidth, _camVideo.videoHeight);
                }
            }
            if (_gestureBadge) {
                _gestureBadge.textContent = '✅ Cam Ready (Tap START AR)';
                _gestureBadge.style.color = '#00ff88';
            }
            console.log('[hands] Startup camera preview active — permission granted!');

            // Also pre-load the MediaPipe AI model in the background while preview is showing so Hand Cam starts instantly later!
            _initMediaPipeModel().catch(() => {});
        } catch (err) {
            console.warn('[hands] Startup camera preview notice:', err.name);
            // If auto-play on page load was blocked by mobile browser (needs a user click gesture),
            // show a clickable "👉 Tap to Enable Camera" button inside the preview box!
            if (_camPreviewBox && !_mpActive && _gestureBadge) {
                _camPreviewBox.style.display = 'flex';
                _gestureBadge.textContent = '👉 Tap Here to Allow Cam';
                _gestureBadge.style.color = '#00ff88';
                _gestureBadge.style.cursor = 'pointer';
                const retryOnClick = () => {
                    _camPreviewBox.removeEventListener('click', retryOnClick);
                    startPreview();
                };
                _camPreviewBox.addEventListener('click', retryOnClick);
            }
        }
    };

    // Run immediately on page load
    startPreview();
}

// ─── Touchscreen Palm Tap Gesture (Mobile AR) ────────────────────────────────
function _setupTouchPalmSummon() {
    const onTouchStart = (e) => {
        if (e.touches && e.touches.length >= 3) {
            console.log(`[hands] Detected ${e.touches.length}-finger palm tap gesture!`);
            spawnPanelAtCamera();
        }
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
}
