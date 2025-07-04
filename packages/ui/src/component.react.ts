import React from "react";

import { createComponent } from "@lit/react";

import { MoreComponent } from "./component";

export const MoreComponentReact = createComponent({
  tagName: "more-component",
  elementClass: MoreComponent,

  react: React,

  events: {
    onactivate: "activate",
    onchange: "change",
  },
});
