import { useState, useRef, useMemo } from "react";
import { z } from "zod";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import type { Route } from "./+types/todos";
import { TodoApi, type TodoItem, type CreateTodo, type UpdateTodo, TodoApiError } from "@more/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/card";

// Client-side API instance
const api = new TodoApi({ baseUrl: "http://localhost:8000" });

/*
================================================================================================
Form types for type safety
================================================================================================
*/
const CreateTodoFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
});

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  }),
  z.object({
    action: z.literal("update"),
    id: z.coerce.number(),
    title: z.string().optional(),
    description: z.string().optional(),
    completed: z.coerce.boolean().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.coerce.number(),
  }),
  z.object({
    action: z.literal("complete"),
    id: z.coerce.number(),
  }),
  z.object({
    action: z.literal("uncomplete"),
    id: z.coerce.number(),
  }),
]);

type ActionData = z.infer<typeof ActionSchema>;

/*
================================================================================================
Loader/Action definitions
================================================================================================
*/
export async function loader() {
  try {
    const [todosResponse, stats] = await Promise.all([
      api.listTodos({ ordering: "-created_at" }),
      api.getStats()
    ]);
    
    return { 
      todos: todosResponse.results, 
      stats,
      error: null 
    };
  } catch (error) {
    console.error("Failed to load todos:", error);
    return { 
      todos: [] as TodoItem[], 
      stats: null,
      error: error instanceof TodoApiError ? error.message : "Failed to load todos" 
    };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsedForm = ActionSchema.safeParse(Object.fromEntries(formData));

  if (parsedForm.error) {
    return {
      errors: parsedForm.error.flatten().fieldErrors,
      success: false,
    };
  }

  const data = parsedForm.data;

  try {
    switch (data.action) {
      case "create":
        const newTodo: CreateTodo = {
          title: data.title,
          description: data.description || "",
          priority: data.priority || "medium",
        };
        await api.createTodo(newTodo);
        break;

      case "update":
        const updates: UpdateTodo = {};
        if (data.title !== undefined) updates.title = data.title;
        if (data.description !== undefined) updates.description = data.description;
        if (data.completed !== undefined) updates.completed = data.completed;
        if (data.priority !== undefined) updates.priority = data.priority;
        
        await api.updateTodo(data.id, updates);
        break;

      case "delete":
        await api.deleteTodo(data.id);
        break;

      case "complete":
        await api.completeTodo(data.id);
        break;

      case "uncomplete":
        await api.uncompleteTodo(data.id);
        break;

      default:
        throw new Error("Invalid action");
    }

    return { success: true, errors: {} };
  } catch (error) {
    console.error("Action failed:", error);
    return {
      success: false,
      errors: { 
        general: [error instanceof TodoApiError ? error.message : "Operation failed"] 
      },
    };
  }
}

/*
================================================================================================
Page metadata
================================================================================================
*/
export function meta() {
  return [
    { title: "Todo App" },
    { name: "description", content: "Manage your todos with drag and drop" },
  ];
}

/*
================================================================================================
Components
================================================================================================
*/

interface TodoItemProps {
  todo: TodoItem;
  onDragStart: (e: React.DragEvent, todo: TodoItem) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTodo: TodoItem) => void;
  fetcher: any;
}

function TodoItemComponent({ todo, onDragStart, onDragOver, onDrop, fetcher }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editDescription, setEditDescription] = useState(todo.description || "");

  const handleEdit = () => {
    if (isEditing) {
      // Save changes
      fetcher.submit(
        {
          action: "update",
          id: todo.id,
          title: editTitle,
          description: editDescription,
        },
        { method: "post" }
      );
    }
    setIsEditing(!isEditing);
  };

  const handleToggleComplete = () => {
    fetcher.submit(
      {
        action: todo.completed ? "uncomplete" : "complete",
        id: todo.id,
      },
      { method: "post" }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this todo?")) {
      fetcher.submit(
        {
          action: "delete",
          id: todo.id,
        },
        { method: "post" }
      );
    }
  };

  const priorityColors = {
    low: "border-l-blue-500",
    medium: "border-l-yellow-500",
    high: "border-l-red-500",
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, todo)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, todo)}
      className={`
        p-4 bg-white border-l-4 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 cursor-move
        ${priorityColors[todo.priority]}
        ${todo.completed ? "opacity-60 line-through" : ""}
        ${fetcher.state !== "idle" ? "opacity-50" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <button
            onClick={handleToggleComplete}
            className={`
              mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors
              ${todo.completed ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-green-400"}
            `}
            disabled={fetcher.state !== "idle"}
          >
            {todo.completed && (
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>

          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Description..."
                />
              </div>
            ) : (
              <div>
                <h3 className="font-medium text-gray-900">{todo.title}</h3>
                {todo.description && (
                  <p className="text-sm text-gray-600 mt-1">{todo.description}</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span className={`
                px-2 py-1 rounded-full text-xs font-medium
                ${todo.priority === "high" ? "bg-red-100 text-red-800" : ""}
                ${todo.priority === "medium" ? "bg-yellow-100 text-yellow-800" : ""}
                ${todo.priority === "low" ? "bg-blue-100 text-blue-800" : ""}
              `}>
                {todo.priority}
              </span>
              {todo.is_overdue && (
                <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full">
                  Overdue
                </span>
              )}
              <span>{new Date(todo.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-1">
          <button
            onClick={handleEdit}
            className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
            disabled={fetcher.state !== "idle"}
          >
            {isEditing ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            )}
          </button>
          <button
            onClick={handleDelete}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
            disabled={fetcher.state !== "idle"}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9zM4 5a2 2 0 012-2v1a1 1 0 001 1h6a1 1 0 001-1V3a2 2 0 012 2v1H4V5zM3 8a1 1 0 011-1h12a1 1 0 110 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2V9a1 1 0 01-1-1V8z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/*
================================================================================================
Main Component
================================================================================================
*/
export default function Todos({ loaderData }: Route.ComponentProps) {
  const { todos: initialTodos, stats, error } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  
  // Form state
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoDescription, setNewTodoDescription] = useState("");
  const [newTodoPriority, setNewTodoPriority] = useState<"low" | "medium" | "high">("medium");
  
  // Filter state
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "low" | "medium" | "high">("all");
  
  // Drag state
  const draggedTodo = useRef<TodoItem | null>(null);

  // Filter todos
  const filteredTodos = useMemo(() => {
    return initialTodos.filter((todo) => {
      const statusMatch = 
        filter === "all" || 
        (filter === "active" && !todo.completed) || 
        (filter === "completed" && todo.completed);
      
      const priorityMatch = 
        priorityFilter === "all" || 
        todo.priority === priorityFilter;
      
      return statusMatch && priorityMatch;
    });
  }, [initialTodos, filter, priorityFilter]);

  // Group todos by status for columns
  const todoColumns = useMemo(() => {
    const active = filteredTodos.filter(todo => !todo.completed);
    const completed = filteredTodos.filter(todo => todo.completed);
    
    return { active, completed };
  }, [filteredTodos]);

  // Reset form after successful submission
  if (fetcher.state === "idle" && fetcher.data?.success) {
    if (newTodoTitle) {
      setNewTodoTitle("");
      setNewTodoDescription("");
      setNewTodoPriority("medium");
    }
  }

  // Handle drag and drop
  const handleDragStart = (e: React.DragEvent, todo: TodoItem) => {
    draggedTodo.current = todo;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetTodo: TodoItem) => {
    e.preventDefault();
    
    if (!draggedTodo.current || draggedTodo.current.id === targetTodo.id) {
      return;
    }

    // If dragging between different completion states, toggle completion
    if (draggedTodo.current.completed !== targetTodo.completed) {
      fetcher.submit(
        {
          action: draggedTodo.current.completed ? "uncomplete" : "complete",
          id: draggedTodo.current.id,
        },
        { method: "post" }
      );
    }

    draggedTodo.current = null;
  };

  const handleColumnDrop = (e: React.DragEvent, completed: boolean) => {
    e.preventDefault();
    
    if (!draggedTodo.current || draggedTodo.current.completed === completed) {
      return;
    }

    fetcher.submit(
      {
        action: completed ? "complete" : "uncomplete",
        id: draggedTodo.current.id,
      },
      { method: "post" }
    );

    draggedTodo.current = null;
  };

  return (
    <div className="font-sans max-w-7xl mx-auto p-8 leading-relaxed text-gray-800">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Todo App</h1>
        <p className="text-gray-600">Manage your tasks with drag and drop functionality</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
              <div className="text-sm text-gray-600">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
              <div className="text-sm text-gray-600">Completed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-orange-600">{stats.incomplete}</div>
              <div className="text-sm text-gray-600">Active</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
              <div className="text-sm text-gray-600">Overdue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span>High:</span>
                  <span className="font-medium">{stats.by_priority.high}</span>
                </div>
                <div className="flex justify-between">
                  <span>Med:</span>
                  <span className="font-medium">{stats.by_priority.medium}</span>
                </div>
                <div className="flex justify-between">
                  <span>Low:</span>
                  <span className="font-medium">{stats.by_priority.low}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* New Todo Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Add New Todo</CardTitle>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="action" value="create" />
            
            <div>
              <input
                name="title"
                type="text"
                placeholder="What needs to be done?"
                value={newTodoTitle}
                onChange={(e) => setNewTodoTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={fetcher.state !== "idle"}
                required
              />
              {fetcher.data?.errors?.title && (
                <p className="text-sm text-red-600 mt-1">{fetcher.data.errors.title}</p>
              )}
            </div>

            <div>
              <textarea
                name="description"
                placeholder="Description (optional)"
                value={newTodoDescription}
                onChange={(e) => setNewTodoDescription(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={2}
                disabled={fetcher.state !== "idle"}
              />
            </div>

            <div className="flex gap-4 items-center">
              <select
                name="priority"
                value={newTodoPriority}
                onChange={(e) => setNewTodoPriority(e.target.value as "low" | "medium" | "high")}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={fetcher.state !== "idle"}
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>

              <button
                type="submit"
                disabled={fetcher.state !== "idle" || !newTodoTitle.trim()}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {fetcher.state !== "idle" ? "Adding..." : "Add Todo"}
              </button>
            </div>

            {fetcher.data?.errors?.general && (
              <p className="text-sm text-red-600">{fetcher.data.errors.general}</p>
            )}
          </fetcher.Form>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex gap-2">
          {(["all", "active", "completed"] as const).map((filterOption) => (
            <button
              key={filterOption}
              onClick={() => setFilter(filterOption)}
              className={`
                px-4 py-2 rounded-lg capitalize transition-colors
                ${filter === filterOption 
                  ? "bg-blue-500 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }
              `}
            >
              {filterOption}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {(["all", "high", "medium", "low"] as const).map((priorityOption) => (
            <button
              key={priorityOption}
              onClick={() => setPriorityFilter(priorityOption)}
              className={`
                px-3 py-2 rounded-lg text-sm capitalize transition-colors
                ${priorityFilter === priorityOption 
                  ? "bg-gray-800 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }
              `}
            >
              {priorityOption === "all" ? "All Priorities" : `${priorityOption} priority`}
            </button>
          ))}
        </div>
      </div>

      {/* Todo Columns */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Active Todos */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            Active ({todoColumns.active.length})
          </h2>
          <div
            onDragOver={handleDragOver}
            onDrop={(e) => handleColumnDrop(e, false)}
            className="space-y-3 min-h-32 p-4 bg-gray-50 rounded-lg"
          >
            {todoColumns.active.map((todo) => (
              <TodoItemComponent
                key={todo.id}
                todo={todo}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                fetcher={fetcher}
              />
            ))}
            {todoColumns.active.length === 0 && (
              <p className="text-gray-500 text-center py-8">No active todos</p>
            )}
          </div>
        </div>

        {/* Completed Todos */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            Completed ({todoColumns.completed.length})
          </h2>
          <div
            onDragOver={handleDragOver}
            onDrop={(e) => handleColumnDrop(e, true)}
            className="space-y-3 min-h-32 p-4 bg-gray-50 rounded-lg"
          >
            {todoColumns.completed.map((todo) => (
              <TodoItemComponent
                key={todo.id}
                todo={todo}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                fetcher={fetcher}
              />
            ))}
            {todoColumns.completed.length === 0 && (
              <p className="text-gray-500 text-center py-8">No completed todos</p>
            )}
          </div>
        </div>
      </div>

      {/* Refresh Button */}
      <div className="mt-8 text-center">
        <button
          onClick={() => revalidator.revalidate()}
          disabled={revalidator.state !== "idle"}
          className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:bg-gray-400 transition-colors"
        >
          {revalidator.state !== "idle" ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}