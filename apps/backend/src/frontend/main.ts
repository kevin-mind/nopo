// Import the UI components which will auto-register the web components
import "@more/ui";

// Add any additional frontend initialization here
console.log("Web components loaded and registered");

// Auto-initialize components when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, web components should be available");

  // Add any global event listeners for web components
  document.addEventListener("component-click", (e: Event) => {
    const customEvent = e as CustomEvent;
    console.log("Global component click handler:", customEvent.detail);
  });
});
