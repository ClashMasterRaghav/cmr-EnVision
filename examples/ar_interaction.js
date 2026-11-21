// Event handlers and interaction logic for AR experience
import * as THREE from 'three';
import {
    camera, scene, controller, renderer, raycaster,
    isPlacingScreen, newScreen, isMoveModeActive,
    isRotateModeActive, selectedScreen, selectedKey,
    setIsMoveModeActive, setIsRotateModeActive,
    setIsPlacingScreen, setNewScreen
} from './ar_core.js';
import {
    screens, selectScreen, updateKeyboardPosition, createNewBrowserScreen,
    createYouTubeScreen, createDuckDuckGoScreen, createGoogleMapsScreen,
    createElectronAppScreen, createScreenFromButton, removeScreen, syncCSS3DObject
} from './ar_screens.js';
import { virtualKeyboard, showNotification, toggleModeButton, controlPanel } from './ar_ui.js';
import { videoElement, duration } from './ar_media.js';

// Touch interaction variables
let touchEnabled = true;
let initialTouchPosition = new THREE.Vector2();
let currentTouchPosition = new THREE.Vector2();
let isTouchMovingScreen = false;
let isRotatingScreen = false;
let lastTapTime = 0;
let screenOffset = new THREE.Vector3();
let initialRotation = new THREE.Euler();
let initialMousePosition = new THREE.Vector2();
// Multi-touch variables
let initialPinchDistance = 0;
let initialScale = new THREE.Vector3(1, 1, 1);
let isPinching = false;

// Panel dragging variables
let isPanelBeingDragged = false;
let panelDragOffset = new THREE.Vector3();
let initialPanelPosition = new THREE.Vector3();
let initialPanelQuaternion = new THREE.Quaternion();
const panelDragPlane = new THREE.Plane();

// Variables for drag handle functionality
let isDraggingHandle = false;
let draggedScreen = null;
let dragOffset = new THREE.Vector3();
const screenDragPlane = new THREE.Plane();

// Import necessary video functions
let videoControlFunctions = {
    togglePlayback: null,
    toggleMute: null
};

// Setup event listeners
export function setupEventListeners() {
    // Controller events
    controller.addEventListener('select', onSelect);
    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);

    // Touch events
    renderer.domElement.addEventListener('touchstart', onTouchStart, false);
    renderer.domElement.addEventListener('touchmove', onTouchMove, false);
    renderer.domElement.addEventListener('touchend', onTouchEnd, false);
}

// Handle controller selection start
function onSelectStart(event) {
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // Check for button intersections
    const buttons = findAllButtons();
    const buttonIntersects = raycaster.intersectObjects(buttons, true);

    if (buttonIntersects.length > 0) {
        // Visual feedback for button press
        const buttonObj = getButtonFromIntersect(buttonIntersects[0].object);
        if (buttonObj) {
            const originalColor = buttonObj.material.color.clone();
            buttonObj.material.color.set(0x4FC3F7); // Highlight color
            setTimeout(() => {
                buttonObj.material.color.copy(originalColor);
            }, 200);
        }
    }
}

// Find the actual button from an intersection
function getButtonFromIntersect(object) {
    // Case 1: Direct hit on button
    if (object.userData && object.userData.type === 'button') {
        return object;
    }

    // Case 2: Hit on a part of the button (icon, shadow, etc)
    if (object.userData && object.userData.type === 'buttonPart' && object.userData.parentButton) {
        return object.userData.parentButton;
    }

    // Case 3: Hit on child of a button
    let parent = object.parent;
    while (parent) {
        if (parent.userData && parent.userData.type === 'button') {
            return parent;
        }
        parent = parent.parent;
    }

    // No button found
    return null;
}

// Handle controller selection end
function onSelectEnd(event) {
    if (isPlacingScreen && newScreen) {
        // Finalize the placement of the new screen
        setIsPlacingScreen(false);
        setNewScreen(null);
        console.log("Screen placed successfully");
        return;
    }
}

// Handle controller selection
function onSelect(event) {
    // Raycast to detect interactive elements
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // First, check for button interactions
    const buttons = findAllButtons();
    console.log(`Checking for interactions with ${buttons.length} buttons`);

    // Use a larger threshold for better button detection
    raycaster.params.Line.threshold = 0.15; // Increased from 0.1 for better detection
    raycaster.params.Points.threshold = 0.15; // Increased from 0.1 for better detection
    raycaster.params.Mesh.threshold = 0.02; // Add mesh threshold for better detection

    const buttonIntersects = raycaster.intersectObjects(buttons, true);

    if (buttonIntersects.length > 0) {
        console.log(`Ray intersected with ${buttonIntersects.length} button objects`);

        // Get closest intersection
        const intersection = buttonIntersects[0];
        console.log(`Closest intersection: distance=${intersection.distance.toFixed(3)}, object=${intersection.object.uuid.substring(0, 8)}`);

        const buttonObj = getButtonFromIntersect(intersection.object);
        if (buttonObj) {
            console.log(`Found button: action=${buttonObj.userData.action}`);
            handleButtonAction(buttonObj);
            return;
        } else {
            console.log("Button parent not found from intersection");
        }
    } else {
        console.log("No button intersections found");
    }

    // Then check for screen selection
    const screenIntersects = raycaster.intersectObjects(screens, true);

    if (screenIntersects.length > 0) {
        const screenObj = getScreenFromIntersect(screenIntersects[0].object);
        if (screenObj) {
            console.log(`Selected screen: ID=${screenObj.userData.id}`);
            // Select screen and update global selectedScreen
            selectScreen(screenObj);

            // If in move mode, start moving
            if (isMoveModeActive) {
                isTouchMovingScreen = true;
            }

            // If in rotate mode, start rotating
            if (isRotateModeActive) {
                isRotatingScreen = true;
                initialRotation.copy(screenObj.rotation);
            }
        }
    }
}

// Get screen object from potentially nested mesh
function getScreenFromIntersect(object) {
    if (!object) {
        console.log("getScreenFromIntersect: No object provided");
        return null;
    }

    console.log("getScreenFromIntersect: Checking object", object.uuid);
    console.log("Object userData:", object.userData ? JSON.stringify(object.userData) : "none");

    // First check if we hit the interaction plane
    if (object.userData && object.userData.type === 'interactionPlane' && object.userData.screen) {
        console.log("Found interaction plane with screen reference");
        return object.userData.screen;
    }

    // If we hit the screen directly
    if (object.userData && object.userData.type === 'screen') {
        console.log("Found screen directly");
        return object;
    }

    // Find parent screen by walking up the hierarchy
    let parent = object.parent;
    let depth = 0;

    while (parent && depth < 5) { // Limit depth to avoid infinite loops
        depth++;
        console.log("Checking parent at depth", depth, parent.uuid);
        console.log("Parent userData:", parent.userData ? JSON.stringify(parent.userData) : "none");

        if (parent.userData && parent.userData.type === 'screen') {
            console.log("Found screen at parent level", depth);
            return parent;
        }
        if (parent.userData && parent.userData.type === 'interactionPlane' && parent.userData.screen) {
            console.log("Found interaction plane at parent level", depth);
            return parent.userData.screen;
        }
        parent = parent.parent;
    }

    // Last resort - check if this is one of the screen objects in our array
    for (let i = 0; i < screens.length; i++) {
        if (screens[i].uuid === object.uuid) {
            console.log("Found screen by matching UUID in screens array");
            return screens[i];
        }
    }

    console.log("No screen found from intersection");
    return null;
}

// Handle different button actions
function handleButtonAction(button) {
    if (!button || !button.userData) {
        console.log("Invalid button object");
        return;
    }

    console.log("Handling button action:", button.userData.action);

    // Extract the button action
    const action = button.userData.action;

    // Provide haptic feedback for button press
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }

    // Handle different button actions
    switch (action) {
        case 'addScreen':
        case 'newScreen':
            console.log("New screen button pressed");
            // Create a new screen positioned in front of the camera
            createNewScreenInFrontOfCamera();
            if (controlPanel) {
                controlPanel.visible = false;
                controlPanel.position.set(0, -9999, 0);
                const btn = document.getElementById('summonPanelBtn');
                if (btn) btn.innerHTML = '<span style="font-size: 20px;">🖐️</span><span>Menu</span>';
            }
            break;

        case 'deleteScreen':
        case 'closeAllScreens':
            console.log("Close All / Delete screens button pressed");
            if (screens && screens.length > 0) {
                while (screens.length > 0) {
                    removeScreen(screens[screens.length - 1]);
                }
                if (navigator.vibrate) {
                    navigator.vibrate([30, 20, 80]);
                }
                createModeChangeIndicator('All Screens Closed');
            } else {
                createModeChangeIndicator('No Screens Open');
            }
            break;

        case 'resizeScreen':
            if (button.userData.screen) {
                toggleResize(button.userData.screen);
            } else if (selectedScreen) {
                toggleResize(selectedScreen);
            }
            break;

        case 'pinScreen':
            const targetScreen = button.userData.screen || selectedScreen;
            if (targetScreen) {
                targetScreen.userData.isPinned = !targetScreen.userData.isPinned;
                createModeChangeIndicator(targetScreen.userData.isPinned ? '📌 Screen Pinned' : 'Screen Unpinned');
            }
            break;

        case 'selectScreenType':
            console.log("Screen type button pressed:", button.userData.screenType);
            // Get camera position and direction
            const cameraPosition = new THREE.Vector3();
            camera.getWorldPosition(cameraPosition);

            const cameraDirection = new THREE.Vector3(0, 0, -1);
            cameraDirection.applyQuaternion(camera.quaternion);

            // Position screen in front of camera
            const screenPosition = cameraPosition.clone().add(cameraDirection.multiplyScalar(1.5));

            // Use the new centralized function to create the appropriate screen
            const screenType = button.userData.screenType;
            const newScreen = createScreenFromButton(screenType, screenPosition);

            // Make it face the camera
            newScreen.lookAt(camera.position);

            // Auto-dismiss control panel when an app is opened to keep AR view uncluttered
            if (controlPanel) {
                controlPanel.visible = false;
                controlPanel.position.set(0, -9999, 0);
                const btn = document.getElementById('summonPanelBtn');
                if (btn) btn.innerHTML = '<span style="font-size: 20px;">🖐️</span><span>Menu</span>';
            }

            // Add visual feedback
            createModeChangeIndicator(`New ${screenType.charAt(0).toUpperCase() + screenType.slice(1)} Screen Created`);
            break;

        case 'moveMode':
            console.log("Move mode button pressed");
            // Toggle move mode
            setIsMoveModeActive(!isMoveModeActive);
            setIsRotateModeActive(false); // Disable rotate mode

            // Update button state
            button.material.color.set(isMoveModeActive ? button.userData.activeColor : button.userData.inactiveColor);

            // Create visual indicator
            createModeChangeIndicator(isMoveModeActive ? 'Move Mode Activated' : 'Move Mode Deactivated');
            break;

        case 'rotateMode':
            console.log("Rotate mode button pressed");
            // Toggle rotate mode
            setIsRotateModeActive(!isRotateModeActive);
            setIsMoveModeActive(false); // Disable move mode

            // Update button state
            button.material.color.set(isRotateModeActive ? button.userData.activeColor : button.userData.inactiveColor);

            // Create visual indicator
            createModeChangeIndicator(isRotateModeActive ? 'Rotate Mode Activated' : 'Rotate Mode Deactivated');
            break;

        // FIXED: Add explicit handling for playButton and volumeButton from screens
        case 'playButton':
            console.log("Play/pause button pressed");
            // Toggle video playback
            if (videoControlFunctions.togglePlayback) {
                videoControlFunctions.togglePlayback();
            }
            break;

        case 'volumeButton':
            console.log("Mute/unmute button pressed");
            // Toggle video mute
            if (videoControlFunctions.toggleMute) {
                videoControlFunctions.toggleMute();
            }
            break;

        // Keep generic play/pause and mute/unmute handlers for compatibility
        case 'play':
        case 'pause':
            console.log("Play/pause button pressed");
            if (videoControlFunctions.togglePlayback) {
                videoControlFunctions.togglePlayback();
            }
            break;

        case 'mute':
        case 'unmute':
            console.log("Mute/unmute button pressed");
            if (videoControlFunctions.toggleMute) {
                videoControlFunctions.toggleMute();
            }
            break;

        default:
            console.log("Unknown button action:", action);
            break;
    }
}

// Create a new screen in front of camera - helper for button action
function createNewScreenInFrontOfCamera() {
    // Get camera position and direction
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);

    const cameraDirection = new THREE.Vector3(0, 0, -1);
    cameraDirection.applyQuaternion(camera.quaternion);

    // Position screen in front of camera at a consistent distance of 1.5m (same as initial screen)
    const screenPosition = cameraPosition.clone().add(cameraDirection.multiplyScalar(1.5));

    // Create new screen at this position
    const newScreen = createNewBrowserScreen(screenPosition);

    // Make it face the camera
    newScreen.lookAt(camera.position);

    // Ensure consistent scale
    newScreen.scale.set(1.0, 1.0, 1.0);

    // Add visual feedback
    createModeChangeIndicator('New Screen Created');

    // Select this screen
    selectScreen(newScreen);

    console.log("Created new screen in front of camera");

    return newScreen;
}

// Toggle move mode
function toggleMoveMode(button) {
    setIsMoveModeActive(!isMoveModeActive);

    // Update button color based on active state
    button.material.color.set(isMoveModeActive ?
        button.userData.activeColor || 0x44cc88 :
        button.userData.inactiveColor || 0x777777);

    // Store the button state directly in the userData
    button.userData.isActive = isMoveModeActive;

    // Deactivate rotate mode if move is active
    if (isMoveModeActive) {
        setIsRotateModeActive(false);

        // Find and update rotate button
        const rotateButton = findButtonByAction('rotateScreen');
        if (rotateButton) {
            rotateButton.material.color.set(rotateButton.userData.inactiveColor || 0x777777);
            rotateButton.userData.isActive = false;
        }
    }

    // Update control panel state in UI module (if available)
    if (typeof toggleModeButton === 'function') {
        toggleModeButton('move');
    }

    // Visual feedback for mode change
    createModeChangeIndicator(isMoveModeActive ? 'Move Mode Activated' : 'Move Mode Deactivated');

    console.log("Move mode:", isMoveModeActive ? "activated" : "deactivated");
}

// Toggle rotate mode
function toggleRotateMode(button) {
    setIsRotateModeActive(!isRotateModeActive);

    // Update button color based on active state
    button.material.color.set(isRotateModeActive ?
        button.userData.activeColor || 0xf39c12 :
        button.userData.inactiveColor || 0x777777);

    // Store the button state directly in the userData
    button.userData.isActive = isRotateModeActive;

    // Deactivate move mode if rotate is active
    if (isRotateModeActive) {
        setIsMoveModeActive(false);

        // Find and update move button
        const moveButton = findButtonByAction('moveScreen');
        if (moveButton) {
            moveButton.material.color.set(moveButton.userData.inactiveColor || 0x777777);
            moveButton.userData.isActive = false;
        }
    }

    // Update control panel state in UI module (if available)
    if (typeof toggleModeButton === 'function') {
        toggleModeButton('rotate');
    }

    // Visual feedback for mode change
    createModeChangeIndicator(isRotateModeActive ? 'Rotate Mode Activated' : 'Rotate Mode Deactivated');

    console.log("Rotate mode:", isRotateModeActive ? "activated" : "deactivated");
}

// Toggle resize for a screen
function toggleResize(screen) {
    if (!screen) return;

    // Check current scale
    const currentScale = screen.scale.x;

    // Store original scale if not already stored
    if (!screen.userData.hasOwnProperty('originalScale')) {
        screen.userData.originalScale = screen.scale.clone();
    }

    // Toggle between sizes
    if (Math.abs(currentScale - 1.0) < 0.1) {
        // Scale up to 1.5x
        screen.scale.set(1.5, 1.5, 1);

        // Create visual feedback for resize
        createModeChangeIndicator('Screen Enlarged');
    } else if (Math.abs(currentScale - 1.5) < 0.1) {
        // Scale up to 2.0x
        screen.scale.set(2.0, 2.0, 1);

        // Create visual feedback for resize
        createModeChangeIndicator('Screen Maximized');
    } else {
        // Return to original scale
        screen.scale.set(1.0, 1.0, 1);

        // Create visual feedback for resize
        createModeChangeIndicator('Screen Reset');
    }

    // Provide haptic feedback if available
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

// Toggle fullscreen for a screen (kept for backward compatibility)
function toggleFullscreen(screen) {
    if (!screen) return;

    // Scale the screen up or down
    if (screen.scale.x === 1) {
        // Scale up to simulate fullscreen
        screen.userData.originalScale = screen.scale.clone();
        screen.scale.set(1.5, 1.5, 1);

        // Move forward slightly
        screen.userData.originalPosition = screen.position.clone();
        screen.position.z += 0.2;

        // Create visual feedback
        createModeChangeIndicator('Fullscreen Mode');
    } else {
        // Return to original scale
        if (screen.userData.originalScale) {
            screen.scale.copy(screen.userData.originalScale);
        } else {
            screen.scale.set(1, 1, 1);
        }

        // Return to original position
        if (screen.userData.originalPosition) {
            screen.position.copy(screen.userData.originalPosition);
        }

        // Create visual feedback
        createModeChangeIndicator('Normal Mode');
    }

    // Provide haptic feedback if available
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

// Find a button by action
function findButtonByAction(action) {
    const buttons = findAllButtons();
    return buttons.find(button =>
        button.userData &&
        button.userData.action === action);
}

// Find all buttons in the scene with improved detection
function findAllButtons() {
    let buttons = [];

    // Get control panel buttons more explicitly (only if visible)
    const controlPanels = scene.children.filter(obj =>
        obj.userData && obj.userData.type === 'controlPanel' && obj.visible !== false);

    console.log(`Found ${controlPanels.length} control panels`);

    controlPanels.forEach((panel, panelIndex) => {
        const panelButtons = [];
        panel.children.forEach(child => {
            if (child.userData && child.userData.type === 'button') {
                panelButtons.push(child);
                buttons.push(child);

                // Increase render order for better interaction
                child.renderOrder = 1500; // Very high renderOrder ensures it's clickable
            }
        });
        console.log(`Panel ${panelIndex}: Found ${panelButtons.length} buttons`);
    });

    // Get screen buttons
    const screenButtons = [];
    screens.forEach((screen, screenIndex) => {
        const buttonsForThisScreen = [];
        screen.children.forEach(child => {
            if (child.userData && child.userData.type === 'button') {
                buttonsForThisScreen.push(child);
                buttons.push(child);
                screenButtons.push(child);

                // Ensure button is always interactive by setting renderOrder
                child.renderOrder = 1500; // Higher renderOrder ensures it renders on top
            }
        });
        if (buttonsForThisScreen.length > 0) {
            console.log(`Screen ${screenIndex}: Found ${buttonsForThisScreen.length} buttons`);
        }
    });

    console.log(`Found total ${buttons.length} buttons (${buttons.length - screenButtons.length} panel + ${screenButtons.length} screen)`);

    return buttons;
}

// Touch start handler
function onTouchStart(event) {
    event.preventDefault();

    console.log("Touch start detected in AR");

    // Multi-touch Palm Gesture: 3 or more fingers touching screen simultaneously summons the Control Panel!
    if (event.touches && event.touches.length >= 3) {
        console.log("3-finger palm gesture detected! Summoning Control Panel.");
        if (window.summonControlPanelAtCamera) {
            window.summonControlPanelAtCamera();
        }
        createModeChangeIndicator('🖐️ Hand Gesture: Menu Summoned!');
        if (navigator.vibrate) {
            navigator.vibrate([40, 40, 80]);
        }
        return;
    }

    // Single touch handling
    const touch = event.touches[0];

    if (!touch) {
        console.log("No valid touch point");
        return;
    }

    // Convert touch to normalized device coordinates
    initialTouchPosition.x = (touch.clientX / window.innerWidth) * 2 - 1;
    initialTouchPosition.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    currentTouchPosition.copy(initialTouchPosition);

    console.log("Touch position:", initialTouchPosition.x.toFixed(3), initialTouchPosition.y.toFixed(3));

    // Update raycaster
    raycaster.setFromCamera(initialTouchPosition, camera);

    // Double tap detection
    const now = performance.now();
    const doubleTapDetected = (now - lastTapTime) < 300;
    lastTapTime = now;

    // PRIORITY 0: Check for control panel dragging
    if (controlPanel && controlPanel.visible) {
        const panelIntersects = raycaster.intersectObject(controlPanel, true);

        // Prevent clicking through any open screen into the control panel!
        let screenInFront = false;
        if (panelIntersects.length > 0 && screens && screens.length > 0) {
            const pDist = panelIntersects[0].distance;
            for (const s of screens) {
                const sHits = raycaster.intersectObject(s, true);
                if (sHits.length > 0 && sHits[0].distance < pDist) {
                    screenInFront = true;
                    break;
                }
            }
        }

        if (panelIntersects.length > 0 && !screenInFront) {
            // Get info about intersection
            const hitPoint = panelIntersects[0].point.clone();
            const localPoint = controlPanel.worldToLocal(hitPoint.clone());
            const hitObject = panelIntersects[0].object;

            console.log("Hit panel object:", hitObject.uuid.slice(0, 8),
                "userData:", hitObject.userData ? JSON.stringify(hitObject.userData) : 'none');

            // Enhanced drag detection - check if we hit:
            // 1. The explicit drag handle or grip lines
            // 2. The top portion of the panel
            // 3. Any object marked as part of drag handle
            const isDragHandle = hitObject.userData && (
                hitObject.userData.isDragArea ||
                hitObject.userData.isPartOfDragHandle ||
                hitObject.userData.type === 'dragHandle' ||
                (hitObject.parent && hitObject.parent.userData &&
                    (hitObject.parent.userData.isDragArea || hitObject.parent.userData.type === 'dragHandle'))
            );

            // First check if this is a button
            const isButton = hitObject.userData && hitObject.userData.type === 'button';

            // If it's a button, handle the button click
            if (isButton) {
                console.log("Touch detected on panel button:", hitObject.userData.action);

                // Visual feedback
                const originalColor = hitObject.material.color.clone();
                hitObject.material.color.set(0x4FC3F7);

                // Scale effect
                const originalScale = hitObject.scale.clone();
                hitObject.scale.multiplyScalar(1.1);

                setTimeout(() => {
                    hitObject.material.color.copy(originalColor);
                    hitObject.scale.copy(originalScale);
                }, 150);

                // Haptic feedback
                if (navigator.vibrate) {
                    navigator.vibrate(40);
                }

                // Handle button click and return
                handleButtonAction(hitObject);
                return;
            }

            // More generous y-position check for the top section
            const isInDragArea = localPoint.y > 0.0;

            if (isDragHandle || isInDragArea) {
                console.log("Starting control panel drag - detected via:", isDragHandle ? "drag handle" : "top area");

                // Store initial panel position and rotation
                initialPanelPosition.copy(controlPanel.position);
                initialPanelQuaternion.copy(controlPanel.quaternion);

                // Initialize plane raycast at hit point for smooth 1:1 dragging
                const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                panelDragPlane.setFromNormalAndCoplanarPoint(camForward, hitPoint);
                panelDragOffset.copy(hitPoint).sub(controlPanel.position);

                // Set flag to indicate panel is being dragged
                isPanelBeingDragged = true;
                controlPanel.userData.isDragging = true;

                // Provide strong haptic feedback like screen dragging
                if (navigator.vibrate) {
                    navigator.vibrate([40, 30, 60]);
                }

                // Add visual feedback
                createModeChangeIndicator('Panel Unlocked - Drag to Position');

                return;
            }
        }
    }

    // Identify all screens close to our touch ray
    const screenIntersections = [];

    // Cast ray against all screens to find potential candidates
    screens.forEach(screen => {
        // Use a more generous ray for each screen
        const intersects = raycaster.intersectObject(screen, true);
        if (intersects.length > 0) {
            // Store information about the hit including distance and all intersected parts
            screenIntersections.push({
                screen: screen,
                distance: intersects[0].distance,
                object: intersects[0].object,
                point: intersects[0].point,
                allHits: intersects
            });
        }
    });

    // Sort by distance so we prioritize closer screens
    screenIntersections.sort((a, b) => a.distance - b.distance);

    // PRIORITY 1: Check for button interactions
    const buttons = findAllButtons();
    console.log("Checking", buttons.length, "buttons for intersection");

    // Increase raycaster params for better touch detection on buttons
    raycaster.params.Line.threshold = 0.15;
    raycaster.params.Points.threshold = 0.15;
    raycaster.params.Mesh.threshold = 0.03; // Add mesh threshold for better touch detection

    const buttonIntersects = raycaster.intersectObjects(buttons, true);

    if (buttonIntersects.length > 0) {
        console.log("Button intersection found!");

        const buttonObj = getButtonFromIntersect(buttonIntersects[0].object);
        if (buttonObj) {
            console.log("Button touched:", buttonObj.userData.action);

            // Add visual and haptic feedback
            if (buttonObj.material) {
                const originalColor = buttonObj.material.color.clone();
                buttonObj.material.color.set(0x4FC3F7); // Highlight color
                // Pulse button scale for visual feedback
                const originalScale = buttonObj.scale.clone();
                buttonObj.scale.multiplyScalar(1.2); // Scale up when touched

                setTimeout(() => {
                    buttonObj.material.color.copy(originalColor);
                    buttonObj.scale.copy(originalScale);
                }, 200);
            }

            // Try to trigger vibration if available
            if (navigator.vibrate) {
                navigator.vibrate(50); // Short vibration for feedback
            }

            handleButtonAction(buttonObj);
            return; // Stop processing touch event
        }
    }

    // PRIORITY 2: Check closest screen for progress bar interaction
    if (screenIntersections.length > 0) {
        const closestHit = screenIntersections[0];
        const screen = closestHit.screen;

        // Check if we hit the progress bar
        if (handleProgressBarTouch(screen, closestHit.point)) {
            console.log("Progress bar touched on screen:", screen.userData.id);
            return;
        }
    }

    // PRIORITY 3: Screen selection
    if (screenIntersections.length > 0) {
        const closestScreen = screenIntersections[0].screen;
        if (closestScreen && selectedScreen !== closestScreen) {
            selectScreen(closestScreen);
        }
    }


    // PRIORITY 4: Regular screen selection - use the closest screen from our sorted list
    if (screenIntersections.length > 0) {
        const closestHit = screenIntersections[0];
        const screen = closestHit.screen;

        console.log("Selected closest screen:", screen.userData.id, "at distance", closestHit.distance.toFixed(2));

        // Select the screen
        selectScreen(screen);

        // Double tap to toggle resize
        if (doubleTapDetected) {
            console.log("Double tap detected, toggling resize");
            toggleResize(screen);

            // Provide haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate([30, 20, 30]);
            }

            createModeChangeIndicator('Size Changed');
            return;
        }

        // Flash highlight around selected screen
        flashScreenHighlight(screen);
        createModeChangeIndicator('Screen Selected');
    }
}

// Flash a highlight effect around a selected screen
function flashScreenHighlight(screen) {
    // Find the border or create one if it doesn't exist
    let highlightMesh = screen.children.find(child =>
        child.userData && child.userData.isHighlight);

    if (!highlightMesh) {
        // Get screen dimensions (use the first plane geometry as reference)
        const screenMesh = screen.children.find(child =>
            child.geometry && child.geometry.type === 'PlaneGeometry');

        let width = 1.05;
        let height = 0.8;

        if (screenMesh && screenMesh.geometry) {
            // Extract dimensions from existing geometry
            const size = new THREE.Vector3();
            screenMesh.geometry.computeBoundingBox();
            screenMesh.geometry.boundingBox.getSize(size);

            // Scale slightly larger than the original screen
            width = size.x * 1.05;
            height = size.y * 1.05;
        }

        // Create highlight mesh
        const glowGeometry = new THREE.PlaneGeometry(width, height);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x4fc3f7,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide
        });

        highlightMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        highlightMesh.position.z = -0.01;
        highlightMesh.userData = { isHighlight: true };
        screen.add(highlightMesh);
    }

    // Animate the highlight
    let opacity = 0;
    const fadeIn = () => {
        opacity += 0.1;
        highlightMesh.material.opacity = opacity;

        if (opacity < 0.6) {
            requestAnimationFrame(fadeIn);
        } else {
            // Fade out
            const fadeOut = () => {
                opacity -= 0.1;
                highlightMesh.material.opacity = opacity;

                if (opacity > 0) {
                    requestAnimationFrame(fadeOut);
                }
            };
            requestAnimationFrame(fadeOut);
        }
    };

    requestAnimationFrame(fadeIn);
}

// Touch move handler - make the movement more responsive and direct
function onTouchMove(event) {
    // Always prevent default to avoid browser gestures
    event.preventDefault();

    // Make sure we have a valid touch point
    const touch = event.touches[0];
    if (!touch) {
        return;
    }

    // Convert touch to normalized device coordinates
    const previousTouchPosition = currentTouchPosition.clone();
    currentTouchPosition.x = (touch.clientX / window.innerWidth) * 2 - 1;
    currentTouchPosition.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    // Handle control panel dragging with smooth plane raycasting
    if (isPanelBeingDragged && controlPanel) {
        raycaster.setFromCamera(currentTouchPosition, camera);
        const planeHit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(panelDragPlane, planeHit)) {
            const targetPos = planeHit.sub(panelDragOffset);
            targetPos.y = THREE.MathUtils.clamp(targetPos.y, -0.6, 0.5);
            controlPanel.position.lerp(targetPos, 0.85);
            controlPanel.lookAt(camera.position);
            controlPanel.userData.manuallyPositioned = true;
        }
        return;
    }

    // Handle dragging screen via drag handle - smooth 1:1 plane raycasting with safety clamping
    if (isDraggingHandle && draggedScreen) {
        try {
            if (draggedScreen.userData && draggedScreen.userData.originalScale) {
                draggedScreen.scale.copy(draggedScreen.userData.originalScale);
            }
            raycaster.setFromCamera(currentTouchPosition, camera);
            const planeHit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(screenDragPlane, planeHit)) {
                const targetPos = planeHit.sub(dragOffset);
                const toTarget = targetPos.clone().sub(camera.position);
                const curDist = toTarget.length();
                // Safety clamp: only apply if within reasonable bounds [0.5m, 3.5m]
                if (curDist >= 0.5 && curDist <= 3.5) {
                    draggedScreen.position.lerp(targetPos, 0.85);
                    draggedScreen.lookAt(camera.position);
                    syncCSS3DObject(draggedScreen);
                }
            }
        } catch (error) {
            console.error("Error in drag movement:", error);
        }
        return;
    }

    // We're not handling other forms of movement to simplify the interaction model
    // This keeps the drag handle as the primary way to move screens, which improves reliability
}

// Move screen based on touch movement
function moveScreenWithTouch() {
    if (!selectedScreen) return;

    // Create more direct movement with less complexity
    // Use a simplified approach that always works

    // Get the camera's forward and right vectors
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

    // Calculate the touch delta
    const touchDelta = new THREE.Vector2(
        currentTouchPosition.x - initialTouchPosition.x,
        currentTouchPosition.y - initialTouchPosition.y
    );

    // Scale the movement (adjust multiplier as needed)
    const movementSpeed = 4.0;

    // Create movement vector in world space
    const movement = new THREE.Vector3()
        .addScaledVector(right, touchDelta.x * movementSpeed)
        .addScaledVector(new THREE.Vector3(0, 1, 0), touchDelta.y * movementSpeed);

    // Apply movement directly
    selectedScreen.position.add(movement);

    // Ensure screen always faces the camera
    selectedScreen.lookAt(camera.position);

    // Keep the screen at a reasonable distance
    const distanceToCamera = selectedScreen.position.distanceTo(camera.position);
    if (distanceToCamera < 0.5 || distanceToCamera > 5) {
        // Get direction from camera to screen
        const direction = selectedScreen.position.clone().sub(camera.position).normalize();

        // Set new position at ideal distance
        const idealDistance = THREE.MathUtils.clamp(distanceToCamera, 0.5, 5);
        selectedScreen.position.copy(camera.position.clone().add(direction.multiplyScalar(idealDistance)));
    }

    // Optional: Add visual feedback
    createMoveIndicator(selectedScreen.position.clone(), 0.03);

    // Update control panel if needed
    if (controlPanel && controlPanel.userData && controlPanel.userData.update) {
        controlPanel.userData.update();
    }
}

// Create a visual indicator for movement feedback
function createMoveIndicator(position, size) {
    // Create a small dot that fades quickly
    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshBasicMaterial({
        color: 0x4fc3f7,
        transparent: true,
        opacity: 0.3
    });

    const indicator = new THREE.Mesh(geometry, material);
    indicator.position.copy(position);

    // Add to scene
    scene.add(indicator);

    // Animate fading out
    const startTime = performance.now();
    const duration = 200; // 200ms

    function fadeOut() {
        const elapsed = performance.now() - startTime;
        const progress = elapsed / duration;

        if (progress < 1) {
            material.opacity = 0.3 * (1 - progress);
            indicator.scale.x = 1 - (progress * 0.5);
            indicator.scale.y = 1 - (progress * 0.5);
            indicator.scale.z = 1 - (progress * 0.5);
            requestAnimationFrame(fadeOut);
        } else {
            scene.remove(indicator);
            geometry.dispose();
            material.dispose();
        }
    }

    requestAnimationFrame(fadeOut);
}

// Rotate screen based on touch movement
function rotateScreenWithTouch() {
    if (!selectedScreen) return;

    // Calculate deltas from initial position
    const deltaX = currentTouchPosition.x - initialMousePosition.x;
    const deltaY = currentTouchPosition.y - initialMousePosition.y;

    // Apply rotation - Y axis movement controls X rotation and vice versa
    selectedScreen.rotation.x = initialRotation.x + (deltaY * 2);
    selectedScreen.rotation.y = initialRotation.y + (deltaX * 2);

    // Limit rotation angles
    selectedScreen.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, selectedScreen.rotation.x));
}

// Touch end handler
function onTouchEnd(event) {
    // Handle end of control panel dragging
    if (isPanelBeingDragged && controlPanel) {
        console.log("Finished dragging control panel");

        // Save the current position and mark panel as manually positioned
        controlPanel.userData.isDragging = false;
        controlPanel.userData.manuallyPositioned = true; // Mark as manually positioned to prevent auto repositioning
        isPanelBeingDragged = false;

        // Provide haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate([20, 10, 20]); // Pattern for "release" feel
        }

        return;
    }

    // Check if we were dragging with the handle
    if (isDraggingHandle && draggedScreen) {
        console.log("Finished dragging screen:", draggedScreen.userData.id);

        // Reset the drag handle appearance if it exists
        if (draggedScreen.userData.dragHandle) {
            // Just reset the color without changing scale for top bar
            draggedScreen.userData.dragHandle.material.color.set(0x333333); // Reset to original dark color
        }

        // Save the current position in userData
        draggedScreen.userData.originalPosition = draggedScreen.position.clone();

        // Ensure scale is preserved
        if (draggedScreen.userData.originalScale) {
            draggedScreen.scale.copy(draggedScreen.userData.originalScale);
        }

        // Provide haptic feedback for completing the drag
        if (navigator.vibrate) {
            navigator.vibrate(20);
        }

        // Create a subtle "settle" animation when dropping the screen
        const originalPosition = draggedScreen.position.clone();

        // Slight drop effect
        const dropAnimation = () => {
            const downPos = originalPosition.clone();
            downPos.y -= 0.01;  // Move slightly down
            draggedScreen.position.lerp(downPos, 0.5);

            setTimeout(() => {
                // Bounce back up
                const upAnimation = () => {
                    draggedScreen.position.lerp(originalPosition, 0.3);
                };
                requestAnimationFrame(upAnimation);
            }, 100);
        };
        requestAnimationFrame(dropAnimation);

        // Show a brief confirmation
        createModeChangeIndicator('Position Saved');

        // Reset dragging state
        isDraggingHandle = false;
        draggedScreen = null;
    }

    // Reset other flags
    isTouchMovingScreen = false;
    isRotatingScreen = false;
    isPinching = false;
}

// Handle progress bar touch for video seeking
function handleProgressBarTouch(screen, point) {
    // Progress bar has been removed, so this function no longer needs to do anything
    // Keeping the function to maintain code structure in case we need to reimplement
    return false;
}

// Update video time based on progress
function updateVideoTime(progress) {
    // Progress bar has been removed, so this function no longer needs to do anything
    // Keeping the function to maintain code structure in case we need to reimplement
}

// Create a floating text indicator for mode changes
function createModeChangeIndicator(message) {
    // Create a canvas for the text
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Draw the text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(50, 150, 255, 0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);

    // Create texture
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(0.3, 0.075);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });

    const indicator = new THREE.Mesh(geometry, material);

    // Position above the control panel
    const cameraDirection = new THREE.Vector3(0, 0, -1);
    cameraDirection.applyQuaternion(camera.quaternion);

    indicator.position.copy(camera.position).add(cameraDirection.multiplyScalar(-0.5));
    indicator.position.y += 0.15; // Position above control panel
    indicator.quaternion.copy(camera.quaternion);

    scene.add(indicator);

    // Fade out and remove
    const startTime = performance.now();
    const duration = 1500; // 1.5 seconds

    function fadeOut() {
        const elapsed = performance.now() - startTime;
        const progress = elapsed / duration;

        if (progress < 1) {
            if (progress > 0.7) {
                // Start fading out in the last 30% of time
                material.opacity = 0.9 * (1 - ((progress - 0.7) / 0.3));
            }

            // Float upward slightly
            indicator.position.y += 0.0002;

            requestAnimationFrame(fadeOut);
        } else {
            scene.remove(indicator);
            material.dispose();
            geometry.dispose();
            texture.dispose();
        }
    }

    requestAnimationFrame(fadeOut);
}

// Helper function to find a screen from a drag handle
function findScreenFromDragHandle(dragHandle) {
    // Direct reference in userData
    if (dragHandle.userData && dragHandle.userData.screen) {
        return dragHandle.userData.screen;
    }

    // Search for screen by UUID
    if (dragHandle.userData && dragHandle.userData.screenUUID) {
        for (let i = 0; i < screens.length; i++) {
            if (screens[i].uuid === dragHandle.userData.screenUUID) {
                return screens[i];
            }
        }
    }

    // Try to find by traversing upwards in the scene graph
    let parent = dragHandle.parent;
    while (parent) {
        if (parent.userData && parent.userData.type === 'screen') {
            return parent;
        }
        parent = parent.parent;
    }

    // Last resort - check if this handle is a direct child of any screen
    for (let i = 0; i < screens.length; i++) {
        for (let j = 0; j < screens[i].children.length; j++) {
            if (screens[i].children[j] === dragHandle) {
                return screens[i];
            }
        }
    }

    console.warn("Could not find screen for drag handle:", dragHandle.uuid);
    return null;
}

// Setup function to be called with imports
export function setupVideoControls(mediaModule) {
    if (mediaModule) {
        // Store references to functions rather than redefining them
        videoControlFunctions.togglePlayback = mediaModule.toggleVideoPlayback;
        videoControlFunctions.toggleMute = mediaModule.toggleVideoMute;
        console.log("Video controls setup complete");
    }
}

// Function to delete the last interacted screen (most recently selected)
export function deleteLastScreen() {
    console.log("deleteLastScreen function called");

    // If no screens, do nothing
    if (!screens || screens.length === 0) {
        console.log("No screens to delete");
        createModeChangeIndicator('No Screens to Delete');
        return false;
    }

    // Get the current selected screen from the imported module variable
    let screenToDelete = selectedScreen;

    console.log("Current selectedScreen:", screenToDelete ?
        (screenToDelete.userData ? screenToDelete.userData.id : "unknown") :
        "null");

    // Verify we have a selected screen to delete
    if (!screenToDelete) {
        console.log("No screen selected for deletion, selecting most recent one");
        // If there's no selected screen, select the last created one (as fallback)
        if (screens.length > 0) {
            screenToDelete = screens[screens.length - 1];
            console.log("Selected most recent screen:", screenToDelete.userData.id);
            // Make sure it's visually marked as selected
            selectScreen(screenToDelete);
        } else {
            return false;
        }
    }

    // Log which screen is being deleted
    console.log("Deleting selected screen with ID:", screenToDelete.userData ? screenToDelete.userData.id : "unknown");

    // Create visual deletion effect
    createDeletionEffect(screenToDelete.position.clone());

    // Remove screen comprehensively (cleans up CSS3D iframe, WebGL mesh, stops media/audio)
    removeScreen(screenToDelete);

    // Provide haptic feedback if available
    if (navigator.vibrate) {
        navigator.vibrate([30, 20, 40]); // Pattern for "delete" feel
    }

    const screenId = screenToDelete.userData && screenToDelete.userData.id !== undefined ?
        screenToDelete.userData.id : 'unknown';
    createModeChangeIndicator(`Screen ${screenId} Deleted`);
    return true;
}

// Create deletion visual effect
function createDeletionEffect(position) {
    // Create particles for deletion effect
    const particleCount = 20;
    const particleGroup = new THREE.Group();

    for (let i = 0; i < particleCount; i++) {
        const size = Math.random() * 0.02 + 0.01;
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(Math.random(), Math.random(), Math.random()),
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });

        const particle = new THREE.Mesh(geometry, material);

        // Random position within screen bounds
        particle.position.set(
            position.x + (Math.random() - 0.5) * 0.5,
            position.y + (Math.random() - 0.5) * 0.5,
            position.z + (Math.random() - 0.5) * 0.1
        );

        // Random velocity
        particle.userData.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02
        );

        particleGroup.add(particle);
    }

    scene.add(particleGroup);

    // Animate particles
    const startTime = performance.now();
    const duration = 1000; // 1 second

    function animateParticles() {
        const elapsed = performance.now() - startTime;
        const progress = elapsed / duration;

        if (progress < 1) {
            // Update each particle
            particleGroup.children.forEach(particle => {
                // Move based on velocity
                particle.position.add(particle.userData.velocity);

                // Fade out
                particle.material.opacity = 0.8 * (1 - progress);

                // Rotate
                particle.rotation.x += 0.01;
                particle.rotation.y += 0.01;
            });

            requestAnimationFrame(animateParticles);
        } else {
            // Clean up
            particleGroup.children.forEach(particle => {
                particle.geometry.dispose();
                particle.material.dispose();
            });
            scene.remove(particleGroup);
        }
    }

    requestAnimationFrame(animateParticles);
}

// Show onboarding instruction about draggable panel
export function showControlPanelInstructions() {
    setTimeout(() => {
        createModeChangeIndicator('Drag the blue panel to reposition controls');
    }, 3000); // Show after a delay to let the user get oriented
} 