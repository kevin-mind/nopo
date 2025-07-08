import { z } from "zod";

//#region src/types.ts
const TodoPriority = z.enum([
	"low",
	"medium",
	"high"
]);
const TodoItemSchema = z.object({
	id: z.number(),
	title: z.string(),
	description: z.string().nullable(),
	completed: z.boolean(),
	priority: TodoPriority,
	due_date: z.string().datetime().nullable(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	is_overdue: z.boolean()
});
const CreateTodoSchema = z.object({
	title: z.string().min(1, "Title cannot be empty"),
	description: z.string().optional(),
	priority: TodoPriority.optional().default("medium"),
	due_date: z.string().datetime().optional()
});
const UpdateTodoSchema = z.object({
	title: z.string().min(1, "Title cannot be empty").optional(),
	description: z.string().optional(),
	completed: z.boolean().optional(),
	priority: TodoPriority.optional(),
	due_date: z.string().datetime().optional()
});
const TodoStatsSchema = z.object({
	total: z.number(),
	completed: z.number(),
	incomplete: z.number(),
	overdue: z.number(),
	by_priority: z.object({
		low: z.number(),
		medium: z.number(),
		high: z.number()
	})
});
const PaginatedTodosSchema = z.object({
	count: z.number(),
	next: z.string().url().nullable(),
	previous: z.string().url().nullable(),
	results: z.array(TodoItemSchema)
});
const ApiErrorSchema = z.object({
	detail: z.string().optional(),
	errors: z.record(z.array(z.string())).optional()
});
const BulkOperationResponseSchema = z.object({
	updated_count: z.number().optional(),
	deleted_count: z.number().optional(),
	message: z.string()
});

//#endregion
//#region src/client.ts
var TodoApiError = class extends Error {
	constructor(message, status, errors) {
		super(message);
		this.status = status;
		this.errors = errors;
		this.name = "ApiError";
	}
};
var TodoApi = class {
	baseUrl;
	defaultHeaders;
	constructor(config = {}) {
		this.baseUrl = config.baseUrl || "http://localhost:8000";
		this.defaultHeaders = {
			"Content-Type": "application/json",
			...config.defaultHeaders
		};
	}
	async request(endpoint, options = {}, schema) {
		const url = `${this.baseUrl}/todo/items${endpoint}`;
		const response = await fetch(url, {
			...options,
			headers: {
				...this.defaultHeaders,
				...options.headers
			}
		});
		if (!response.ok) {
			let errorData;
			try {
				const errorJson = await response.json();
				errorData = ApiErrorSchema.parse(errorJson);
			} catch {}
			throw new TodoApiError(errorData?.detail || `HTTP ${response.status}: ${response.statusText}`, response.status, errorData?.errors);
		}
		const data = await response.json();
		if (schema) return schema.parse(data);
		return data;
	}
	async listTodos(params) {
		const searchParams = new URLSearchParams();
		if (params?.completed !== void 0) searchParams.set("completed", String(params.completed));
		if (params?.priority) searchParams.set("priority", params.priority);
		if (params?.search) searchParams.set("search", params.search);
		if (params?.ordering) searchParams.set("ordering", params.ordering);
		if (params?.page) searchParams.set("page", String(params.page));
		const queryString = searchParams.toString();
		const endpoint = queryString ? `/?${queryString}` : "/";
		return this.request(endpoint, { method: "GET" }, PaginatedTodosSchema);
	}
	async getTodo(id) {
		return this.request(`/${id}/`, { method: "GET" }, TodoItemSchema);
	}
	async createTodo(todo) {
		const validatedTodo = CreateTodoSchema.parse(todo);
		return this.request("/", {
			method: "POST",
			body: JSON.stringify(validatedTodo)
		}, TodoItemSchema);
	}
	async updateTodo(id, updates) {
		const validatedUpdates = UpdateTodoSchema.parse(updates);
		return this.request(`/${id}/`, {
			method: "PATCH",
			body: JSON.stringify(validatedUpdates)
		}, TodoItemSchema);
	}
	async deleteTodo(id) {
		await this.request(`/${id}/`, { method: "DELETE" });
	}
	async completeTodo(id) {
		return this.request(`/${id}/complete/`, { method: "POST" }, TodoItemSchema);
	}
	async uncompleteTodo(id) {
		return this.request(`/${id}/uncomplete/`, { method: "POST" }, TodoItemSchema);
	}
	async getStats() {
		return this.request("/stats/", { method: "GET" }, TodoStatsSchema);
	}
	async completeAll() {
		return this.request("/complete_all/", { method: "POST" }, BulkOperationResponseSchema);
	}
	async clearCompleted() {
		return this.request("/clear_completed/", { method: "DELETE" }, BulkOperationResponseSchema);
	}
};
const todoApi = new TodoApi();

//#endregion
export { ApiErrorSchema, BulkOperationResponseSchema, CreateTodoSchema, PaginatedTodosSchema, TodoApi, TodoApiError, TodoItemSchema, TodoPriority, TodoStatsSchema, UpdateTodoSchema, todoApi as default, todoApi };