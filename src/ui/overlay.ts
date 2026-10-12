import type { Album, User } from '../types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ICON_SOUND_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_SOUND_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

/** The thin layer of HTML over the 3D scene. */
export class Overlay {
  private caption = $('caption');
  private hint = $('hint');
  private toastEl = $('toast');
  private loading = $('loading');
  private login = $('login');
  private toastTimer = 0;
  private hintText = '';

  /* ------------------------------ caption ------------------------------ */

  setCaption(album: Album | null) {
    if (!album) {
      this.caption.classList.remove('visible');
      return;
    }
    this.caption.querySelector('.caption-title')!.textContent = album.name;
    const meta = [album.artist, album.year].filter(Boolean).join(' · ');
    this.caption.querySelector('.caption-meta')!.textContent = meta;
    this.caption.classList.add('visible');
  }

  positionCaption(x: number, y: number) {
    this.caption.style.left = `${x}px`;
    this.caption.style.top = `${y}px`;
  }

  /* -------------------------------- hint ------------------------------- */

  setHint(text: string | null, top = false) {
    if (text && text === this.hintText) {
      this.hint.classList.toggle('top', top);
      return;
    }
    this.hintText = text ?? '';
    if (!text) {
      this.hint.classList.remove('visible');
      return;
    }
    this.hint.classList.remove('visible');
    window.setTimeout(() => {
      if (this.hintText !== text) return;
      this.hint.textContent = text;
      this.hint.classList.toggle('top', top);
      this.hint.classList.add('visible');
    }, 180);
  }

  /* ------------------------------- toast ------------------------------- */

  toast(message: string, ms = 4200) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), ms);
  }

  setLoading(text: string | null) {
    this.loading.hidden = !text;
    if (text) this.loading.querySelector('span')!.textContent = text;
  }

  /* ------------------------------- topbar ------------------------------ */

  initSound(isMuted: () => boolean, toggle: () => void) {
    const btn = $('sound');
    const render = () => {
      btn.innerHTML = isMuted() ? ICON_SOUND_OFF : ICON_SOUND_ON;
      btn.title = isMuted() ? 'Sound effects off' : 'Sound effects on';
    };
    btn.addEventListener('click', () => {
      toggle();
      render();
    });
    render();
  }

  setMode(label: string | null, title = '') {
    const el = $('mode');
    el.hidden = !label;
    el.textContent = label ?? '';
    el.title = title;
  }

  setUser(user: User | null, onLogout: () => void) {
    const el = $<HTMLButtonElement>('user');
    if (!user) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = '';
    if (user.imageUrl) {
      const img = document.createElement('img');
      img.src = user.imageUrl;
      img.alt = '';
      el.appendChild(img);
    } else {
      const a = document.createElement('span');
      a.className = 'avatar';
      a.textContent = user.name.slice(0, 1).toUpperCase();
      el.appendChild(a);
    }
    const name = document.createElement('span');
    name.textContent = user.name;
    el.appendChild(name);
    el.title = 'Log out';
    el.onclick = () => {
      if (confirm(`Log out ${user.name}?`)) onLogout();
    };
  }

  /* -------------------------------- login ------------------------------ */

  showLogin(opts: {
    needsClientId: boolean;
    clientId: string;
    redirectUri: string;
    error?: string;
    onConnect: (clientId: string) => void;
    onDemo: () => void;
  }) {
    this.login.hidden = false;
    this.login.classList.remove('leaving');
    const setup = $<HTMLDetailsElement>('setup');
    const input = $<HTMLInputElement>('client-id');
    const err = $('login-error');
    $('redirect-uri').textContent = opts.redirectUri;
    input.value = opts.clientId;
    if (!opts.needsClientId) {
      input.parentElement?.querySelector('label')?.setAttribute('hidden', '');
      input.hidden = true;
    } else if (!opts.clientId) setup.open = true;
    err.hidden = !opts.error;
    err.textContent = opts.error ?? '';

    $('connect').onclick = () => {
      const id = input.value.trim();
      if (opts.needsClientId && !/^[0-9a-f]{32}$/i.test(id)) {
        setup.open = true;
        err.hidden = false;
        err.textContent = 'Paste the Client ID of your Spotify app (32 characters).';
        input.focus();
        return;
      }
      opts.onConnect(id);
    };
    $('demo').onclick = () => opts.onDemo();
  }

  hideLogin() {
    this.login.classList.add('leaving');
    window.setTimeout(() => (this.login.hidden = true), 500);
  }
}
