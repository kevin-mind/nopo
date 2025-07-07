import { useState, useEffect } from "react";
import { z } from "zod";
import { useFetcher } from "react-router";
import type { Route } from "./+types/home";

import { TwindComponent } from "~/components/twind/twind.react";
import { PureComponent } from "~/components/pure/pure.react";
import { sleep } from "~/utils";

/*
================================================================================================
Form types for type safety across loader, action, and component
================================================================================================
*/
const schema = z.object({
  count: z.coerce.number(),
  name: z.string().min(10, "Name must be at least 10 characters"),
});
type Schema = z.infer<typeof schema>;

/*
================================================================================================
State machine, in production would be a database call or upstream API call
================================================================================================
*/
let { count: _count, name: _name } = {
  count: 0,
  name: "Who?",
} satisfies Schema;
// End state machine

/*
================================================================================================
Loader/Action definitions. This is essentially the implicit API for our page component.
================================================================================================
*/
export async function loader() {
  await sleep(1_000);
  return { count: _count, name: _name } satisfies Schema;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsedForm = schema.safeParse(Object.fromEntries(formData));

  if (parsedForm.error) {
    return {
      errors: parsedForm.error.flatten().fieldErrors,
    };
  }

  if (parsedForm.data.count) {
    _count += parsedForm.data.count;
  }

  if (parsedForm.data.name) {
    _name = parsedForm.data.name;
  }

  await sleep(2_000);
  return { count: _count, name: _name };
}

/*
================================================================================================
Page level metadata definitions
================================================================================================
*/
export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

/*
================================================================================================
Component definition
================================================================================================
*/
export default function Home({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher<typeof action>();

  const [formCount, setFormCount] = useState(loaderData.count);
  const [formName, setFormName] = useState(loaderData.name);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.errors) {
      setFormCount(0);
      setFormName("");
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full">
      <fetcher.Form method="post" className="space-y-4 w-full">
        <div className="space-y-2">
          <label
            htmlFor="count"
            className="block text-sm font-medium text-gray-700"
          >
            Count
          </label>
          <input
            id="count"
            disabled={fetcher.state !== "idle"}
            name="count"
            type="number"
            value={formCount}
            onChange={(e) => setFormCount(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {fetcher.data?.errors?.count && (
            <p className="text-sm text-red-600">{fetcher.data.errors.count}</p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700"
          >
            Name
          </label>
          <input
            id="name"
            disabled={fetcher.state !== "idle"}
            name="name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {fetcher.data?.errors?.name && (
            <p className="text-sm text-red-600">{fetcher.data.errors.name}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={fetcher.state !== "idle"}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Submit
        </button>
      </fetcher.Form>

      <div className="flex flex-col gap-4 w-full">
        <div className="p-4 shadow-inner w-full">
          <p className="text-2xl font-bold">Twind</p>
          <div className="flex flex-col items-center justify-center py-4">
            <TwindComponent name="World" />
          </div>
        </div>
        <div className="p-4 shadow-inner w-full">
          <p className="text-2xl font-bold">Pure</p>
          <div className="flex flex-col items-center justify-center py-4">
            <PureComponent name="World" />
          </div>
        </div>
      </div>

      <div className="mt-8 w-full">
        <pre className="p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto">
          <code>
            {JSON.stringify({ loaderData, fetcher: fetcher.data }, null, 2)}
          </code>
        </pre>
      </div>
    </div>
  );
}
