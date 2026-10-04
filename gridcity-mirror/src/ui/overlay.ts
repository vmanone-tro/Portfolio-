// Guest-facing text layer: branding, status messages and prompts (plain DOM over the canvas).

export class Overlay {
  private status: HTMLElement;
  private statusTitle: HTMLElement;
  private statusDetail: HTMLElement;
  private prompt: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML(
      'beforeend',
      `<div class="overlay">
        <header class="brand"><span class="brand-mark">GRID CITY</span><span class="brand-sub">VR</span></header>
        <div class="status" hidden><div class="status-title"></div><div class="status-detail"></div></div>
        <div class="prompt" hidden></div>
        <div class="toast" hidden></div>
        <footer class="privacy">Camera is used live only — nothing is recorded.</footer>
      </div>`,
    );
    this.status = parent.querySelector('.status')!;
    this.statusTitle = parent.querySelector('.status-title')!;
    this.statusDetail = parent.querySelector('.status-detail')!;
    this.prompt = parent.querySelector('.prompt')!;
    this.toastEl = parent.querySelector('.toast')!;
  }

  /** Big centred message (camera problems, loading). Empty title hides it. */
  setStatus(title: string, detail = ''): void {
    this.status.hidden = !title;
    if (this.statusTitle.textContent !== title) this.statusTitle.textContent = title;
    if (this.statusDetail.textContent !== detail) this.statusDetail.textContent = detail;
  }

  setPrompt(text: string): void {
    this.prompt.hidden = !text;
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
  }

  /** Short operator feedback, e.g. after a hotkey. */
  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), ms);
  }
}
