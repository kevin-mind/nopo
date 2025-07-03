import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('ui-form')
export class Form extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background-color: #f9f9f9;
    }
    
    form {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  `;

  override render() {
    return html`
      <form>
        <div>&lt;FOrm!&gt;</div>
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ui-form': Form;
  }
}

export default Form;
