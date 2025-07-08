// Export types
export * from "./types";

// Export client (excluding conflicting ApiError which is now TodoApiError)
export { TodoApi, TodoApiError, todoApi, type TodoApiConfig } from "./client";

// Export default instance for convenience
export { todoApi as default } from "./client";