// Used by the single-file Artifact build, where only Google Fonts may load.
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap';
document.head.appendChild(link);
