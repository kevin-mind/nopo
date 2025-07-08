import { jsxs as a, jsx as e } from "react/jsx-runtime";
import b from "react";
import { cva as f } from "../node_modules/.pnpm/class-variance-authority@0.7.1/node_modules/class-variance-authority/dist/index.js";
import { clsx as y } from "../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.js";
const u = f(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background",
  {
    variants: {
      variant: {
        primary: "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800",
        secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300",
        outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100",
        ghost: "text-gray-700 hover:bg-gray-100 active:bg-gray-200",
        link: "text-primary-600 underline-offset-4 hover:underline"
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 py-2",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-8 text-lg"
      },
      fullWidth: {
        true: "w-full"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
), x = b.forwardRef(
  ({
    className: s,
    variant: o,
    size: n,
    fullWidth: l,
    asChild: h = !1,
    loading: r = !1,
    leftIcon: t,
    rightIcon: i,
    children: c,
    disabled: m,
    ...g
  }, d) => {
    const p = m || r;
    return /* @__PURE__ */ a(
      "button",
      {
        className: y(u({ variant: o, size: n, fullWidth: l, className: s })),
        ref: d,
        disabled: p,
        ...g,
        children: [
          r && /* @__PURE__ */ a(
            "svg",
            {
              className: "animate-spin -ml-1 mr-2 h-4 w-4",
              xmlns: "http://www.w3.org/2000/svg",
              fill: "none",
              viewBox: "0 0 24 24",
              children: [
                /* @__PURE__ */ e(
                  "circle",
                  {
                    className: "opacity-25",
                    cx: "12",
                    cy: "12",
                    r: "10",
                    stroke: "currentColor",
                    strokeWidth: "4"
                  }
                ),
                /* @__PURE__ */ e(
                  "path",
                  {
                    className: "opacity-75",
                    fill: "currentColor",
                    d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  }
                )
              ]
            }
          ),
          !r && t && /* @__PURE__ */ e("span", { className: "mr-2", children: t }),
          c,
          i && /* @__PURE__ */ e("span", { className: "ml-2", children: i })
        ]
      }
    );
  }
);
x.displayName = "Button";
export {
  x as Button,
  u as buttonVariants
};
//# sourceMappingURL=button.js.map
