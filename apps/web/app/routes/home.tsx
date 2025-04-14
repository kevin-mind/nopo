import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

import db, { desc } from "db";
import { users, userInsertSchema } from "db/schema";
import { Form } from "react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export async function loader() {
  const results = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(10);
  return { users: results };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = userInsertSchema.parse(Object.fromEntries(formData));
  console.log({ parsed, formData });
  return await db.insert(users).values(parsed).returning();
}

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const [count, setCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (actionData) {
      inputRef.current!.value = "";
    }
  }, [actionData]);

  return (
    <>
      <Form
        method="post"
        className="flex flex-col gap-4 my-3"
        onSubmit={() => {
          flushSync(() => {
            setCount(0);
            inputRef.current!.focus();
          });
        }}
      >
        <input
          ref={inputRef}
          type="text"
          name="name"
          className="border-2 border-gray-300 rounded-md p-2"
        />
        <button type="submit" className="bg-blue-500 text-white p-2 rounded-md">
          Add
        </button>
      </Form>
      <ul>
        {loaderData.users.map((user) => (
          <li key={user.id}>
            {user.id} {user.name}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-4 my-3">
        <button onClick={() => setCount(count + 1)}>Increment {count}</button>
      </div>
      <Welcome />
    </>
  );
}
