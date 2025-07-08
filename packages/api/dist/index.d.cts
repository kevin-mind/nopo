import { z } from "zod";

//#region src/types.d.ts
declare const TodoPriority: z.ZodEnum<["low", "medium", "high"]>;
type TodoPriority = z.infer<typeof TodoPriority>;
declare const TodoItemSchema: z.ZodObject<{
  id: z.ZodNumber;
  title: z.ZodString;
  description: z.ZodNullable<z.ZodString>;
  completed: z.ZodBoolean;
  priority: z.ZodEnum<["low", "medium", "high"]>;
  due_date: z.ZodNullable<z.ZodString>;
  created_at: z.ZodString;
  updated_at: z.ZodString;
  is_overdue: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
  id: number;
  title: string;
  description: string | null;
  completed: boolean;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  is_overdue: boolean;
}, {
  id: number;
  title: string;
  description: string | null;
  completed: boolean;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  is_overdue: boolean;
}>;
type TodoItem = z.infer<typeof TodoItemSchema>;
declare const CreateTodoSchema: z.ZodObject<{
  title: z.ZodString;
  description: z.ZodOptional<z.ZodString>;
  priority: z.ZodDefault<z.ZodOptional<z.ZodEnum<["low", "medium", "high"]>>>;
  due_date: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
  title: string;
  priority: "low" | "medium" | "high";
  description?: string | undefined;
  due_date?: string | undefined;
}, {
  title: string;
  description?: string | undefined;
  priority?: "low" | "medium" | "high" | undefined;
  due_date?: string | undefined;
}>;
type CreateTodo = z.infer<typeof CreateTodoSchema>;
declare const UpdateTodoSchema: z.ZodObject<{
  title: z.ZodOptional<z.ZodString>;
  description: z.ZodOptional<z.ZodString>;
  completed: z.ZodOptional<z.ZodBoolean>;
  priority: z.ZodOptional<z.ZodEnum<["low", "medium", "high"]>>;
  due_date: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
  title?: string | undefined;
  description?: string | undefined;
  completed?: boolean | undefined;
  priority?: "low" | "medium" | "high" | undefined;
  due_date?: string | undefined;
}, {
  title?: string | undefined;
  description?: string | undefined;
  completed?: boolean | undefined;
  priority?: "low" | "medium" | "high" | undefined;
  due_date?: string | undefined;
}>;
type UpdateTodo = z.infer<typeof UpdateTodoSchema>;
declare const TodoStatsSchema: z.ZodObject<{
  total: z.ZodNumber;
  completed: z.ZodNumber;
  incomplete: z.ZodNumber;
  overdue: z.ZodNumber;
  by_priority: z.ZodObject<{
    low: z.ZodNumber;
    medium: z.ZodNumber;
    high: z.ZodNumber;
  }, "strip", z.ZodTypeAny, {
    low: number;
    medium: number;
    high: number;
  }, {
    low: number;
    medium: number;
    high: number;
  }>;
}, "strip", z.ZodTypeAny, {
  completed: number;
  total: number;
  incomplete: number;
  overdue: number;
  by_priority: {
    low: number;
    medium: number;
    high: number;
  };
}, {
  completed: number;
  total: number;
  incomplete: number;
  overdue: number;
  by_priority: {
    low: number;
    medium: number;
    high: number;
  };
}>;
type TodoStats = z.infer<typeof TodoStatsSchema>;
declare const PaginatedTodosSchema: z.ZodObject<{
  count: z.ZodNumber;
  next: z.ZodNullable<z.ZodString>;
  previous: z.ZodNullable<z.ZodString>;
  results: z.ZodArray<z.ZodObject<{
    id: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    completed: z.ZodBoolean;
    priority: z.ZodEnum<["low", "medium", "high"]>;
    due_date: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
    is_overdue: z.ZodBoolean;
  }, "strip", z.ZodTypeAny, {
    id: number;
    title: string;
    description: string | null;
    completed: boolean;
    priority: "low" | "medium" | "high";
    due_date: string | null;
    created_at: string;
    updated_at: string;
    is_overdue: boolean;
  }, {
    id: number;
    title: string;
    description: string | null;
    completed: boolean;
    priority: "low" | "medium" | "high";
    due_date: string | null;
    created_at: string;
    updated_at: string;
    is_overdue: boolean;
  }>, "many">;
}, "strip", z.ZodTypeAny, {
  count: number;
  next: string | null;
  previous: string | null;
  results: {
    id: number;
    title: string;
    description: string | null;
    completed: boolean;
    priority: "low" | "medium" | "high";
    due_date: string | null;
    created_at: string;
    updated_at: string;
    is_overdue: boolean;
  }[];
}, {
  count: number;
  next: string | null;
  previous: string | null;
  results: {
    id: number;
    title: string;
    description: string | null;
    completed: boolean;
    priority: "low" | "medium" | "high";
    due_date: string | null;
    created_at: string;
    updated_at: string;
    is_overdue: boolean;
  }[];
}>;
type PaginatedTodos = z.infer<typeof PaginatedTodosSchema>;
declare const ApiErrorSchema: z.ZodObject<{
  detail: z.ZodOptional<z.ZodString>;
  errors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
  detail?: string | undefined;
  errors?: Record<string, string[]> | undefined;
}, {
  detail?: string | undefined;
  errors?: Record<string, string[]> | undefined;
}>;
type ApiError = z.infer<typeof ApiErrorSchema>;
declare const BulkOperationResponseSchema: z.ZodObject<{
  updated_count: z.ZodOptional<z.ZodNumber>;
  deleted_count: z.ZodOptional<z.ZodNumber>;
  message: z.ZodString;
}, "strip", z.ZodTypeAny, {
  message: string;
  updated_count?: number | undefined;
  deleted_count?: number | undefined;
}, {
  message: string;
  updated_count?: number | undefined;
  deleted_count?: number | undefined;
}>;
type BulkOperationResponse = z.infer<typeof BulkOperationResponseSchema>; //#endregion
//#region src/client.d.ts
declare class TodoApiError extends Error {
  status: number;
  errors?: Record<string, string[]> | undefined;
  constructor(message: string, status: number, errors?: Record<string, string[]> | undefined);
}
interface TodoApiConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}
declare class TodoApi {
  private baseUrl;
  private defaultHeaders;
  constructor(config?: TodoApiConfig);
  private request;
  listTodos(params?: {
    completed?: boolean;
    priority?: "low" | "medium" | "high";
    search?: string;
    ordering?: string;
    page?: number;
  }): Promise<PaginatedTodos>;
  getTodo(id: number): Promise<TodoItem>;
  createTodo(todo: CreateTodo): Promise<TodoItem>;
  updateTodo(id: number, updates: UpdateTodo): Promise<TodoItem>;
  deleteTodo(id: number): Promise<void>;
  completeTodo(id: number): Promise<TodoItem>;
  uncompleteTodo(id: number): Promise<TodoItem>;
  getStats(): Promise<TodoStats>;
  completeAll(): Promise<BulkOperationResponse>;
  clearCompleted(): Promise<BulkOperationResponse>;
}
declare const todoApi: TodoApi;

//#endregion
export { ApiError, ApiErrorSchema, BulkOperationResponse, BulkOperationResponseSchema, CreateTodo, CreateTodoSchema, PaginatedTodos, PaginatedTodosSchema, TodoApi, TodoApiConfig, TodoApiError, TodoItem, TodoItemSchema, TodoPriority, TodoStats, TodoStatsSchema, UpdateTodo, UpdateTodoSchema, todoApi as default, todoApi };