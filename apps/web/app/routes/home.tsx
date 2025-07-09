import { useState, useEffect } from "react";
import { z } from "zod";
import { useFetcher } from "react-router";
import type { Route } from "./+types/home";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/card";
import { Button } from "@more/ui";

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
    <div className="font-sans max-w-4xl mx-auto p-8 leading-relaxed text-gray-800 flex flex-col gap-6">
      <Card className="bg-gradient-to-r from-purple-500 to-blue-500 text-white">
        <CardHeader>
          <CardTitle>🚀 React Router + Vite Setup Complete!</CardTitle>
          <CardDescription className="text-purple-200">
            This page demonstrates React Router v7 with Vite asset integration
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Welcome to Your React-Powered App</CardTitle>
          <CardDescription>
            This page demonstrates several key React Router features:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>File-based Routing:</strong> Routes are defined by the
              files in <code>app/routes</code>.
            </li>
            <li>
              <strong>Data Loading:</strong> The <code>loader</code> function
              fetches data before rendering.
            </li>
            <li>
              <strong>Mutations:</strong> The <code>action</code> function
              handles form submissions and data mutations.
            </li>
            <li>
              <strong>Pending UI:</strong> The <code>useFetcher</code> hook
              provides status for data loading and submissions.
            </li>
            <li>
              <strong>Static Asset Integration:</strong> CSS and JS assets via
              Vite processing
            </li>
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Interactive Demo</CardTitle>
          <CardDescription>
            Use the form below to see the loader and action in action.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                <p className="text-sm text-red-600">
                  {fetcher.data.errors.count}
                </p>
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
                <p className="text-sm text-red-600">
                  {fetcher.data.errors.name}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={fetcher.state !== "idle"}
              variant="ghost"
            >
              Submit
            </Button>
          </fetcher.Form>
        </CardContent>
        <CardFooter>
          <div className="w-full">
            <pre className="p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto">
              <code>
                {JSON.stringify({ loaderData, fetcher: fetcher.data }, null, 2)}
              </code>
            </pre>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
