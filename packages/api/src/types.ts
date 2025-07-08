import { z } from "zod";

// Priority enum based on Django model
export const TodoPriority = z.enum(["low", "medium", "high"]);
export type TodoPriority = z.infer<typeof TodoPriority>;

// Todo item schema based on Django serializer
export const TodoItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  completed: z.boolean(),
  priority: TodoPriority,
  due_date: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  is_overdue: z.boolean(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

// Create todo schema (what we send to create a new todo)
export const CreateTodoSchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  description: z.string().optional(),
  priority: TodoPriority.optional().default("medium"),
  due_date: z.string().datetime().optional(),
});

export type CreateTodo = z.infer<typeof CreateTodoSchema>;

// Update todo schema (what we send to update a todo)
export const UpdateTodoSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").optional(),
  description: z.string().optional(),
  completed: z.boolean().optional(),
  priority: TodoPriority.optional(),
  due_date: z.string().datetime().optional(),
});

export type UpdateTodo = z.infer<typeof UpdateTodoSchema>;

// Stats schema for the stats endpoint
export const TodoStatsSchema = z.object({
  total: z.number(),
  completed: z.number(),
  incomplete: z.number(),
  overdue: z.number(),
  by_priority: z.object({
    low: z.number(),
    medium: z.number(),
    high: z.number(),
  }),
});

export type TodoStats = z.infer<typeof TodoStatsSchema>;

// API response schemas
export const PaginatedTodosSchema = z.object({
  count: z.number(),
  next: z.string().url().nullable(),
  previous: z.string().url().nullable(),
  results: z.array(TodoItemSchema),
});

export type PaginatedTodos = z.infer<typeof PaginatedTodosSchema>;

// API Error schema
export const ApiErrorSchema = z.object({
  detail: z.string().optional(),
  errors: z.record(z.array(z.string())).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// Bulk operation response schemas
export const BulkOperationResponseSchema = z.object({
  updated_count: z.number().optional(),
  deleted_count: z.number().optional(),
  message: z.string(),
});

export type BulkOperationResponse = z.infer<typeof BulkOperationResponseSchema>;