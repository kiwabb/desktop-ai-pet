// Load only the requested surface: frame isolation must not import app CSS.
if (new URLSearchParams(window.location.search).get('view') === 'frame')
  void import('./frame-preview')
else
  void import('./chat-panel-preview')

export {}
