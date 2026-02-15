/**
 * Main TypeScript entry point for the Django backend
 * This file demonstrates Vite + TypeScript integration with Django
 */

// Import the CSS file to ensure it's processed by Vite
import "../css/tailwind.css";

/**
 * Initialize the application
 */

let clicked = false;

function initApp(): void {
  // eslint-disable-next-line no-console
  console.log("🚀 Django + Vite + TypeScript integration working!");
  // eslint-disable-next-line no-console
  console.log("Build timestamp:", new Date().toISOString());

  // Add some interactive functionality to demonstrate the integration
  const viteButton = document.querySelector("#vite-button");
  if (viteButton) {
    // Add a click listener to demonstrate TypeScript functionality
    viteButton.addEventListener("click", (event: Event) => {
      // eslint-disable-next-line no-console
      console.log("Button clicked:", event.target);
      if (!clicked) {
        viteButton.innerHTML = "Clicked!";
        clicked = true;
      } else {
        viteButton.innerHTML = "Click me!";
        clicked = false;
      }
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
