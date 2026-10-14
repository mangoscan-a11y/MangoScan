// Applies the saved theme before first paint so there is no flash of the wrong theme.
// Kept as a separate file so the server can enforce script-src 'self'.
(function () {
  var stored = null
  try {
    stored = localStorage.getItem('mangoscan-theme')
  } catch {
    stored = null
  }
  var isDark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
})()
