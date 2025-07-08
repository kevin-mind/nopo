import {
  TodoItem,
  TodoItemSchema,
  CreateTodo,
  CreateTodoSchema,
  UpdateTodo,
  UpdateTodoSchema,
  TodoStats,
  TodoStatsSchema,
  PaginatedTodos,
  PaginatedTodosSchema,
  BulkOperationResponse,
  BulkOperationResponseSchema,
  ApiError as ApiErrorType,
  ApiErrorSchema,
} from "./types";

export class TodoApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TodoApiConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export class TodoApi {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(config: TodoApiConfig = {}) {
    this.baseUrl = config.baseUrl || "http://localhost:8000";
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...config.defaultHeaders,
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: any
  ): Promise<T> {
    const url = `${this.baseUrl}/todo/items${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errorData: ApiErrorType | undefined;
      try {
        const errorJson = await response.json();
        errorData = ApiErrorSchema.parse(errorJson);
      } catch {
        // If we can't parse the error, create a generic one
      }

      throw new TodoApiError(
        errorData?.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData?.errors
      );
    }

    const data = await response.json();
    
    if (schema) {
      return schema.parse(data);
    }
    
    return data;
  }

  // List todos with optional filtering
  async listTodos(params?: {
    completed?: boolean;
    priority?: "low" | "medium" | "high";
    search?: string;
    ordering?: string;
    page?: number;
  }): Promise<PaginatedTodos> {
    const searchParams = new URLSearchParams();
    
    if (params?.completed !== undefined) {
      searchParams.set("completed", String(params.completed));
    }
    if (params?.priority) {
      searchParams.set("priority", params.priority);
    }
    if (params?.search) {
      searchParams.set("search", params.search);
    }
    if (params?.ordering) {
      searchParams.set("ordering", params.ordering);
    }
    if (params?.page) {
      searchParams.set("page", String(params.page));
    }

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/?${queryString}` : "/";
    
    return this.request(endpoint, { method: "GET" }, PaginatedTodosSchema);
  }

  // Get a single todo by ID
  async getTodo(id: number): Promise<TodoItem> {
    return this.request(`/${id}/`, { method: "GET" }, TodoItemSchema);
  }

  // Create a new todo
  async createTodo(todo: CreateTodo): Promise<TodoItem> {
    const validatedTodo = CreateTodoSchema.parse(todo);
    
    return this.request(
      "/",
      {
        method: "POST",
        body: JSON.stringify(validatedTodo),
      },
      TodoItemSchema
    );
  }

  // Update a todo
  async updateTodo(id: number, updates: UpdateTodo): Promise<TodoItem> {
    const validatedUpdates = UpdateTodoSchema.parse(updates);
    
    return this.request(
      `/${id}/`,
      {
        method: "PATCH",
        body: JSON.stringify(validatedUpdates),
      },
      TodoItemSchema
    );
  }

  // Delete a todo
  async deleteTodo(id: number): Promise<void> {
    await this.request(`/${id}/`, { method: "DELETE" });
  }

  // Mark a todo as completed
  async completeTodo(id: number): Promise<TodoItem> {
    return this.request(
      `/${id}/complete/`,
      { method: "POST" },
      TodoItemSchema
    );
  }

  // Mark a todo as incomplete
  async uncompleteTodo(id: number): Promise<TodoItem> {
    return this.request(
      `/${id}/uncomplete/`,
      { method: "POST" },
      TodoItemSchema
    );
  }

  // Get todo statistics
  async getStats(): Promise<TodoStats> {
    return this.request("/stats/", { method: "GET" }, TodoStatsSchema);
  }

  // Complete all todos
  async completeAll(): Promise<BulkOperationResponse> {
    return this.request(
      "/complete_all/",
      { method: "POST" },
      BulkOperationResponseSchema
    );
  }

  // Clear completed todos
  async clearCompleted(): Promise<BulkOperationResponse> {
    return this.request(
      "/clear_completed/",
      { method: "DELETE" },
      BulkOperationResponseSchema
    );
  }
}

// Default instance for easy importing
export const todoApi = new TodoApi();