// ar_hands.js — Hand Tracking & Summoning Module
// Supports:
//   1. WebXR Hand Tracking (XRHand) on XR headsets (Quest / Vision Pro)
//   2. MediaPipe Hands (via webcam / camera video stream)
//   3. 3-Finger Screen Palm Tap gesture on mobile WebXR
//   4. Futuristic Floating HUD Summon Pill in DOM Overlay
//
// Gesture → Action:
//   Open palm (5 extended fingers) / 3-finger screen tap → Spawn control panel in front of user
//   Fist → Dismiss control panel

import * as THREE from 'three';

// ─── State ────────────────────────────────────────────────────────────────────
let handsSupported = false;
const trackedHands = new Map(); // handedness → XRInputSource

let _controlPanel = null;   // set via setControlPanelRef()
let _renderer     = null;
let _scene        = null;
let _camera       = null;
let panelVisible  = true;
let panelLocked   = false;

let openPalmStartTime = 0;
let fistStartTime     = 0;
const OPEN_PALM_HOLD_MS = 350;
const FIST_HOLD_MS      = 300;

// Pre-allocated vectors to avoid per-frame GC pressure
const _palmCenter = new THREE.Vector3();
const _tipPos     = new THREE.Vector3();
const _panelTarget = new THREE.Vector3();

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
 * @param {THREE.Group} controlPanelRef  Reference to the control panel group.
 * @param {THREE.WebGLRenderer} [rendererRef] Optional renderer reference.
 * @param {THREE.Scene} [sceneRef] Optional scene reference.
 * @param {THREE.Camera} [cameraRef] Optional camera reference.
 */
export function initHandTracking(controlPanelRef, rendererRef = null, sceneRef = null, cameraRef = null) {
    _controlPanel = controlPanelRef;
    if (rendererRef) _renderer = rendererRef;
    if (sceneRef)    _scene    = sceneRef;
    if (cameraRef)   _camera   = cameraRef;

    // Attach global helper so buttons and touch gestures can summon panel
    window.summonControlPanelAtCamera = spawnPanelAtCamera;

    // Setup HUD summon button click handler
    _setupHUDButton();

    // Setup touchscreen 3+ finger palm tap gesture right away (no camera prompt needed!)
    _setupTouchPalmSummon();

    if (!_renderer || !_renderer.xr) {
        console.warn('[hands] Renderer or XR not ready — hand tracking disabled.');
        return;
    }

    _renderer.xr.addEventListener('sessionstart', _onSessionStart);
    _renderer.xr.addEventListener('sessionend',   _onSessionEnd);

    console.log('[hands] Hand tracking module initialized.');
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
export function spawnPanelAtCamera() {
    if (!_controlPanel) return;
    const cam = _camera || (window.__arCamera || null);
    if (!cam) return;

    const btn = document.getElementById('summonPanelBtn');

    // Toggle: if control panel is currently visible, dismiss it!
    if (_controlPanel.visible) {
        _controlPanel.visible = false;
        panelVisible = false;
        _controlPanel.position.set(0, -9999, 0); // Physically remove from raycast & view path!
        if (btn) btn.innerHTML = '<span style="font-size: 20px;">🖐️</span><span>Menu</span>';
        console.log('[hands] Control panel dismissed via toggle.');
        return;
    }

    // Otherwise show it right in front of user
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

    // Position 0.85m in front of user, slightly below eye level (-0.1m)
    _panelTarget.copy(cam.position)
        .addScaledVector(forward, 0.85)
        .add(new THREE.Vector3(0, -0.1, 0));

    _controlPanel.position.copy(_panelTarget);
    _controlPanel.lookAt(cam.position);

    _controlPanel.visible = true;
    panelVisible = true;
    _controlPanel.userData.manuallyPositioned = true;
    _controlPanel.userData.isDragging = false;
    if (btn) btn.innerHTML = '<span style="font-size: 20px;">✕</span><span>Close</span>';

    console.log('[hands] Control panel summoned at camera.');
}

/**
 * Call every XR frame from the render loop.
 * @param {XRFrame} frame
 */
export function updateHands(frame) {
    if (!frame || !handsSupported || !_renderer || !_renderer.xr) return;

    const session  = _renderer.xr.getSession();
    const refSpace = _renderer.xr.getReferenceSpace();
    if (!session || !refSpace) return;

    let anyPalmOpen = false;
    let anyFist     = false;
    let palmPosition = null;
    let palmNormal   = null;

    for (const source of session.inputSources) {
        if (!source.hand) continue;

        const palmResult = _detectOpenPalm(frame, refSpace, source.hand);
        if (palmResult.detected) {
            anyPalmOpen  = true;
            palmPosition = palmResult.position;
            palmNormal   = palmResult.normal;
        }

        if (_detectFist(frame, refSpace, source.hand)) {
            anyFist = true;
        }
    }

    // ── Gesture state machine ──────────────────────────────────────────────
    const now = performance.now();

    if (anyPalmOpen) {
        fistStartTime = 0;

        if (!panelVisible) {
            if (openPalmStartTime === 0) openPalmStartTime = now;
            if (now - openPalmStartTime >= OPEN_PALM_HOLD_MS) {
                _spawnPanelAtPalm(palmPosition, palmNormal);
                openPalmStartTime = 0;
            }
        } else if (!panelLocked && palmPosition) {
            _updatePanelPosition(palmPosition, palmNormal);
        }
    } else {
        openPalmStartTime = 0;

        if (anyFist && panelVisible && !panelLocked) {
            if (fistStartTime === 0) fistStartTime = now;
            if (now - fistStartTime >= FIST_HOLD_MS) {
                _dismissPanel();
                fistStartTime = 0;
            }
        } else {
            fistStartTime = 0;
        }
    }
}

/** Lock the panel in its current world position (called by lock button). */
export function lockPanel() {
    panelLocked = true;
    if (_controlPanel) {
        _controlPanel.userData.manuallyPositioned = true;
        _controlPanel.userData.isDragging = false;
    }
    console.log('[hands] Panel locked in place.');
}

/** Release the panel so it follows the hand again. */
export function unlockPanel() {
    panelLocked = false;
    if (_controlPanel) _controlPanel.userData.manuallyPositioned = false;
    console.log('[hands] Panel unlocked.');
}

export function isPanelLocked()            { return panelLocked; }
export function isHandTrackingSupported()  { return handsSupported; }

// ─── Private helpers ──────────────────────────────────────────────────────────

function _setupHUDButton() {
    const btn = document.getElementById('summonPanelBtn');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            spawnPanelAtCamera();
        });
    }
}

function _onSessionStart() {
    if (!_renderer || !_renderer.xr) return;
    const session = _renderer.xr.getSession();
    if (!session) return;

    session.addEventListener('inputsourceschange', _onInputSourcesChange);

    // Show floating summon HUD in DOM overlay
    const hud = document.getElementById('handControlHUD');
    if (hud) hud.style.display = 'block';

    // Position control panel comfortably in front of user at startup
    setTimeout(() => {
        spawnPanelAtCamera();
    }, 600);

    console.log('[hands] XR session started — control panel active.');
}

function _onSessionEnd() {
    handsSupported = false;
    trackedHands.clear();
    openPalmStartTime = 0;
    fistStartTime     = 0;

    // Hide HUD button when session ends
    const hud = document.getElementById('handControlHUD');
    if (hud) hud.style.display = 'none';

    if (_controlPanel) _controlPanel.visible = true;

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

/**
 * Returns { detected, position, normal } for an open palm via WebXR XRHand.
 */
function _detectOpenPalm(frame, refSpace, hand) {
    const SPREAD = 0.07; // metres

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

    const camPos = _camera ? _camera.position : new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3()
        .subVectors(camPos, _palmCenter)
        .normalize();

    return { detected: true, position: _palmCenter.clone(), normal };
}

/**
 * Returns true if hand is making a fist via WebXR XRHand.
 */
function _detectFist(frame, refSpace, hand) {
    const CLOSED = 0.05;

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

function _spawnPanelAtPalm(palmPosition, palmNormal) {
    if (!_controlPanel) return;

    _panelTarget.copy(palmPosition)
        .addScaledVector(palmNormal, 0.09)
        .add(new THREE.Vector3(0, 0.05, 0));

    _controlPanel.position.copy(_panelTarget);
    if (_camera) _controlPanel.lookAt(_camera.position);
    _controlPanel.visible = true;
    panelVisible = true;

    console.log('[hands] Panel spawned at palm.');
}

function _updatePanelPosition(palmPosition, palmNormal) {
    if (!_controlPanel) return;

    _panelTarget.copy(palmPosition)
        .addScaledVector(palmNormal, 0.09)
        .add(new THREE.Vector3(0, 0.05, 0));

    _controlPanel.position.lerp(_panelTarget, 0.12);
    if (_camera) _controlPanel.lookAt(_camera.position);
}

function _dismissPanel() {
    if (!_controlPanel) return;
    _controlPanel.visible = false;
    panelVisible = false;
    _controlPanel.position.set(0, -9999, 0);
    const btn = document.getElementById('summonPanelBtn');
    if (btn) btn.innerHTML = '<span style="font-size: 20px;">🖐️</span><span>Menu</span>';
    console.log('[hands] Panel dismissed by fist gesture.');
}

// ─── Touchscreen Palm Tap Gesture (Mobile AR) ────────────────────────────────
function _setupTouchPalmSummon() {
    // 3-to-5 finger touch gesture / palm tap on touchscreen summons the control panel
    const onTouchStart = (e) => {
        if (e.touches && e.touches.length >= 3) {
            console.log(`[hands] Detected ${e.touches.length}-finger palm tap gesture!`);
            spawnPanelAtCamera();
        }
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
}
