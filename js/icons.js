// Uygulama simgeleri: tek çizgi kalınlığında, currentColor ile boyanan satır içi SVG'ler.
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.6.6 2.7 2.2 3 4.7"/>',
  microscope: '<path d="M6 20h12M9 20a6 6 0 0 1 9-5.2"/><path d="m10.5 4.5 3 1.7-3.5 6-3-1.7z"/><path d="M12 14.5a2 2 0 1 0 0-.01M14.2 5.6l1-1.7"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.6 17.2A2.2 2.2 0 0 0 7.5 20.5h9a2.2 2.2 0 0 0 1.9-3.3l-4.9-8.5V3.5"/><path d="M7.6 14.5h8.8"/>',
  book: '<path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z"/><path d="M5 19.5a2 2 0 0 0 2 2h12v-4M9 8h6"/>',
  clipboard: '<rect x="5.5" y="5" width="13" height="15.5" rx="2.5"/><path d="M9 5a3 3 0 0 1 6 0M9 11h6M9 15h4"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  back: '<path d="m14.5 6-6 6 6 6"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 9a4 4 0 0 1 0 6M7.5 15l1 4.5"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.6 3.4M16 6.5h2.5a2.5 2.5 0 0 1-2.6 3.4M12 13.5v3.5M8.5 20h7M9.5 20l.5-3h4l.5 3"/>',
  repeat: '<path d="M17 3.5 19.5 6 17 8.5"/><path d="M4.5 12V10a4 4 0 0 1 4-4h11M7 20.5 4.5 18 7 15.5"/><path d="M19.5 12v2a4 4 0 0 1-4 4h-11"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.6 1.7-2.6h1.9a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>',
  key: '<circle cx="8" cy="15" r="3.8"/><path d="m10.8 12.3 7.7-7.8M15.5 7.5l2.5 2.5M13.5 9.5l2 2"/>',
  logout: '<path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7"/><path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M10 11v6M14 11v6"/>',
  edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="m14 8 2.5 2.5"/>',
  forward: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
  cancel: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  undo: '<path d="M8 8.5H15a4.5 4.5 0 0 1 0 9h-5"/><path d="m11 5-3.5 3.5L11 12"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.2 4.2 0 0 0 7 0"/><circle cx="9.3" cy="10" r=".8"/><circle cx="14.7" cy="10" r=".8"/>',
  user: '<circle cx="12" cy="8.5" r="3.7"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 11.4-4.3M18.5 14v6M15.5 17h6"/>',
  download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  note: '<path d="M5.5 4.5h13v10l-5 5h-8z"/><path d="M13.5 19.5v-5h5M9 9h6M9 12.5h3"/>',
  check: '<path d="m5.5 12.5 4 4 9-9.5"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  promote: '<path d="M12 19.5V7M7 11.5l5-5 5 5M5 4.5h14"/>',
  umbrella: '<path d="M3.5 12a8.5 8.5 0 0 1 17 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0M12 3.5v1"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
};
const NS = 'http://www.w3.org/2000/svg';

/** Satır içi SVG simge. Bilinmeyen ad boş simge döndürür. */
export function icon(name, size = 22, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ico ${cls}`.trim());
  svg.innerHTML = P[name] || '';
  return svg;
}
export const ICON_NAMES = Object.keys(P);
