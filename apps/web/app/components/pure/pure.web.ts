import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("pure-component")
export class PureComponent extends LitElement {
  @property()
  name?: string = "World";

  handleClick() {
    console.log("clicked", Math.random());
  }

  override render() {
    return html`
      <button
        @click=${this.handleClick}
        class="bg-blue-200 text-yellow-200 p-2 rounded-full text-2xl"
      >
        Hello ${this.name}!
      </button>
    `;
  }
}
