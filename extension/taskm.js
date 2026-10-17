/* Runs on TaskM itself. It tells TaskM the button is installed, and passes along TaskM's
   "link my email" requests, so the student can link Gmail or Outlook from TaskM's Email view. */
document.documentElement.setAttribute('data-taskm-ext', '1');
window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.type !== 'taskm-read' || typeof d.url !== 'string') return;
  chrome.runtime.sendMessage({ type: 'read', url: d.url, title: String(d.title || '') });
});
