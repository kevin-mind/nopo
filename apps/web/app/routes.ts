import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/todos", "routes/todos.tsx"),
  route("/__version__", "routes/__version__.tsx"),
] satisfies RouteConfig;
