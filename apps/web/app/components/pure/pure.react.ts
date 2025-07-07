import * as React from "react";
import { createComponent } from "@lit/react";

import { PureComponent as _PureComponent } from "./pure.web";

export const PureComponent = createComponent({
  react: React,
  tagName: "pure-component",
  elementClass: _PureComponent,
});
