/**
 * Main TypeScript entry point for the Django backend
 * This file demonstrates Vite + TypeScript integration with Django
 */

// Import the CSS file to ensure it's processed by Vite
import "../css/main.css";

/**
 * Initialize the application
 */
function initApp(): void {
  console.log("🚀 Django + Vite + TypeScript integration working!");
  console.log("Build timestamp:", new Date().toISOString());

  // Add some interactive functionality to demonstrate the integration
  const body = document.body;
  if (body) {
    // Add a class to demonstrate CSS integration
    body.classList.add("vite-powered");

    // Add a click listener to demonstrate TypeScript functionality
    body.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "BUTTON" ||
        target.classList.contains("clickable")
      ) {
        console.log("Button clicked:", target);
        target.innerHTML = "Clicked!";
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
