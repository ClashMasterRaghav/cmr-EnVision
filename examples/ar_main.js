// Main entry point for AR Web application
import * as THREE from 'three';
import { initAR } from './ar_core.js';
import { initCSS3DRenderer } from './ar_screens.js';

function startApplication() {
    console.log("Starting AR Web application...");

    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessage = document.getElementById('errorMessage');
    const interactionHelper = document.getElementById('interactionHelper');
    const videoElement = document.getElementById('videoElement');

    // Ensure interaction helper is hidden so it doesn't block the screen
    if (interactionHelper) {
        interactionHelper.style.display = 'none';
    }

    // Configure video element for background/texture autoplay
    if (videoElement) {
        videoElement.muted = true;
        videoElement.playsInline = true;
        videoElement.setAttribute('playsinline', '');
        videoElement.setAttribute('webkit-playsinline', '');
        
        // Attempt immediate playback; catch silently if autoplay policy blocks it
        videoElement.play().catch(() => {
            // Unblock on the very first touch/click anywhere on the page
            const unlockMedia = () => {
                videoElement.play().catch(() => {});
                window.removeEventListener('click', unlockMedia);
                window.removeEventListener('touchstart', unlockMedia);
            };
            window.addEventListener('click', unlockMedia, { once: true, passive: true });
            window.addEventListener('touchstart', unlockMedia, { once: true, passive: true });
        });
    }

    try {
        // Initialize core AR environment (Three.js scene, camera, lights, ARButton, render loop)
        const initialized = initAR();
        if (initialized !== false) {
            console.log("Core AR initialized successfully.");
        }

        // Initialize CSS3D renderer for rich web content
        try {
            initCSS3DRenderer();
            console.log("CSS3D Renderer initialized for web content.");
        } catch (cssErr) {
            console.warn("CSS3D Renderer setup note:", cssErr);
        }

        // Hide the loading message now that the AR canvas and button are rendered
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }
    } catch (error) {
        console.error("Failed to initialize AR experience:", error);
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }
        if (errorMessage) {
            errorMessage.innerHTML = `
                <h2>AR Initialization Failed</h2>
                <p>There was a problem starting the AR experience: ${error.message}</p>
                <p>Please try reloading the page or using Chrome with WebXR enabled.</p>
            `;
            errorMessage.style.display = 'block';
        }
    }
}

// Bootstrap safely regardless of whether DOMContentLoaded has already fired
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApplication);
} else {
    startApplication();
}
