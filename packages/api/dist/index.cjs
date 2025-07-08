Object.defineProperty(exports, '__esModule', { value: true });
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const zod = __toESM(require("zod"));

//#region src/types.ts
const TodoPriority = zod.z.enum([
	"low",
	"medium",
	"high"
]);
const TodoItemSchema = zod.z.object({
	id: zod.z.number(),
	title: zod.z.string(),
	description: zod.z.string().nullable(),
	completed: zod.z.boolean(),
	priority: TodoPriority,
	due_date: zod.z.string().datetime().nullable(),
	created_at: zod.z.string().datetime(),
	updated_at: zod.z.string().datetime(),
	is_overdue: zod.z.boolean()
});
const CreateTodoSchema = zod.z.object({
	title: zod.z.string().min(1, "Title cannot be empty"),
	description: zod.z.string().optional(),
	priority: TodoPriority.optional().default("medium"),
	due_date: zod.z.string().datetime().optional()
});
const UpdateTodoSchema = zod.z.object({
	title: zod.z.string().min(1, "Title cannot be empty").optional(),
	description: zod.z.string().optional(),
	completed: zod.z.boolean().optional(),
	priority: TodoPriority.optional(),
	due_date: zod.z.string().datetime().optional()
});
const TodoStatsSchema = zod.z.object({
	total: zod.z.number(),
	completed: zod.z.number(),
	incomplete: zod.z.number(),
	overdue: zod.z.number(),
	by_priority: zod.z.object({
		low: zod.z.number(),
		medium: zod.z.number(),
		high: zod.z.number()
	})
});
const PaginatedTodosSchema = zod.z.object({
	count: zod.z.number(),
	next: zod.z.string().url().nullable(),
	previous: zod.z.string().url().nullable(),
	results: zod.z.array(TodoItemSchema)
});
const ApiErrorSchema = zod.z.object({
	detail: zod.z.string().optional(),
	errors: zod.z.record(zod.z.array(zod.z.string())).optional()
});
const BulkOperationResponseSchema = zod.z.object({
	updated_count: zod.z.number().optional(),
	deleted_count: zod.z.number().optional(),
	message: zod.z.string()
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
exports.ApiErrorSchema = ApiErrorSchema;
exports.BulkOperationResponseSchema = BulkOperationResponseSchema;
exports.CreateTodoSchema = CreateTodoSchema;
exports.PaginatedTodosSchema = PaginatedTodosSchema;
exports.TodoApi = TodoApi;
exports.TodoApiError = TodoApiError;
exports.TodoItemSchema = TodoItemSchema;
exports.TodoPriority = TodoPriority;
exports.TodoStatsSchema = TodoStatsSchema;
exports.UpdateTodoSchema = UpdateTodoSchema;
exports.default = todoApi;
exports.todoApi = todoApi;