import { useId, type ComponentProps } from "react";
import { cn } from "~/utils";

interface FormInputProps extends ComponentProps<"input"> {
  label: string;
  description?: string;
}

export function FormInput({
  label,
  description,
  className,
  id: providedId,
  ...props
}: FormInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={descriptionId}
        className={cn(
          "w-full px-3 py-2 border border-gray-300 rounded-md",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
          className,
        )}
        {...props}
      />
      {description && (
        <p id={descriptionId} className="text-sm text-gray-500">
          {description}
        </p>
      )}
    </div>
  );
}
