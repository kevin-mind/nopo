import { Form } from "react-router";
import type { Route } from "./+types/home";

let count = 0;

export async function loader() {
  return { count };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const increment = formData.get("increment");
  if (typeof increment === "string") {
    count += parseInt(increment);
  }
  return { count };
}

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <>
      <p>Count: {loaderData.count}</p>
      <Form method="post">
        <input name="increment" type="number" />
        <button type="submit">Submit</button>
      </Form>
      <pre>
        {JSON.stringify({ loaderData, actionData }, null, 2)}
      </pre>
    </>
  );
}
