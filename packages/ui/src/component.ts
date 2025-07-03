import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('ui-component')
export class Component extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 16px;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
  `;

  override render() {
    return html`
      <div>Component</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ui-component': Component;
  }
}

export default Component;
