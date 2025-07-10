import * as React from "react";

import { cn } from "../lib/utils";

export function Button({
  children,
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "bg-blue-500 text-white border-2 border-blue-700 px-4 py-2 rounded-md cursor-pointer transition-all duration-200 hover:bg-blue-700 hover:-translate-y-0.5 disabled:bg-gray-400 disabled:border-gray-500 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:hover:-translate-y-0",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
