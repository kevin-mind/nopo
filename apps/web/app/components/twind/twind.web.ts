import { html } from "lit";
import { customElement, property } from "lit/decorators.js";

import { TailwindElement } from "~/shared/tailwind.element";

@customElement("twind-component")
export class TwindComponent extends TailwindElement {
  @property()
  name?: string = "World";

  override render() {
    return html`
      <button class="bg-blue-200 text-yellow-200 p-2 rounded-full text-2xl">
        Hello ${this.name}!
      </button>
    `;
  }
}
