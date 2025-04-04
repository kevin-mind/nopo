import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

import db from "db";
import { users, userInsertSchema } from "db/schema";
import { Form } from "react-router";

export async function loader() {
  const results = await db.select().from(users).limit(10);
  return { users: results };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  formData.set("foo", "bar");
  const parsed = userInsertSchema.parse(Object.fromEntries(formData));
  return await db.insert(users).values(parsed).returning();
}

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  return [
    <pre>{JSON.stringify(loaderData, null, 2)}</pre>,
    <pre>{JSON.stringify(actionData, null, 2)}</pre>,
    <Form method="post">
      <input type="text" name="name" />
      <button type="submit">Add</button>
    </Form>,
    <Welcome />,
  ];
}
