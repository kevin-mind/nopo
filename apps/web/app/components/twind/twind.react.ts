import * as React from "react";
import { createComponent } from "@lit/react";

import { TwindComponent as _TwindComponent } from "./twind.web";

export const TwindComponent = createComponent({
  react: React,
  tagName: "twind-component",
  elementClass: _TwindComponent,
});
