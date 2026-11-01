/**
 * ISETA chat widget — Deep Chat (https://deepchat.dev) connected to OpenRouter.
 * Injected into every mirrored page; shows a floating button that opens a
 * chat panel backed by the OpenRouter Chat Completion API.
 */
(function () {
  'use strict';

  var OPENROUTER_KEY = 'REDACTED';
  var OPENROUTER_MODEL = 'openai/gpt-4o-mini';
  var DEEP_CHAT_BUNDLE = 'https://unpkg.com/deep-chat@2.5.1/dist/deepChat.bundle.js';

  var scriptEl = document.currentScript;
  var base = scriptEl ? scriptEl.src.slice(0, scriptEl.src.lastIndexOf('/') + 1) : '';

  // Load the stylesheet next to this script.
  var cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = base + 'chat.css';
  cssLink.setAttribute('data-iseta-chat-css', 'true');
  document.head.appendChild(cssLink);

  var panel;
  var panelBody;
  var fab;
  var chatEl;
  var loadingBundle = false;

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.6 3 2.2 6.6 2.2 11c0 2.4 1.3 4.5 3.4 6-.2 1.2-.8 2.4-1.9 3.4a.5.5 0 0 0 .4.9c2 0 3.7-.7 5-1.7.9.2 1.9.4 2.9.4 5.4 0 9.8-3.6 9.8-8S17.4 3 12 3zm-4.5 9.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm4.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm4.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>';

  function createWidget() {
    fab = document.createElement('button');
    fab.className = 'iseta-chat-fab';
    fab.setAttribute('aria-label', 'Abrir chat de asistencia');
    fab.innerHTML = ICON_CHAT;
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    panel = document.createElement('div');
    panel.className = 'iseta-chat-panel';
    panel.innerHTML =
      '<div class="iseta-chat-header">' +
      '<span>Asistente ISETA</span>' +
      '<button class="iseta-chat-close" aria-label="Cerrar chat">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
      '</button>' +
      '</div>' +
      '<div class="iseta-chat-body"></div>';
    panel
      .querySelector('.iseta-chat-close')
      .addEventListener('click', closePanel);
    document.body.appendChild(panel);

    panelBody = panel.querySelector('.iseta-chat-body');
  }

  function togglePanel() {
    if (panel.classList.contains('open')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function closePanel() {
    panel.classList.remove('open');
    fab.setAttribute('aria-label', 'Abrir chat de asistencia');
  }

  function openPanel() {
    panel.classList.add('open');
    fab.setAttribute('aria-label', 'Cerrar chat de asistencia');

    if (chatEl || loadingBundle) {
      return;
    }
    loadingBundle = true;
    panelBody.innerHTML = '<div class="iseta-chat-loading">Cargando asistente…</div>';

    import(DEEP_CHAT_BUNDLE)
      .then(function () {
        buildChat();
      })
      .catch(function () {
        panelBody.innerHTML =
          '<div class="iseta-chat-loading">No se pudo cargar el chat. Revisá tu conexión e intentá de nuevo.</div>';
      });
  }

  function buildChat() {
    chatEl = document.createElement('deep-chat');
    chatEl.directConnection = {
      openRouter: {
        key: OPENROUTER_KEY,
        model: OPENROUTER_MODEL,
        system_prompt:
          'Sos el asistente virtual del ISETA (Instituto Experimental de Tecnología Alimentaria). ' +
          'Respondé siempre en español, de forma clara, breve y amable. Ayudá sobre la institución, ' +
          'sus carreras, departamentos, servicios, horarios y novedades. Si no conocés un dato exacto, ' +
          'sugerí contactar al instituto en lugar de inventar información.',
        max_tokens: 1024,
      },
    };
    chatEl.stream = true;
    chatEl.introMessage = {
      text:
        '¡Hola! 👋 Soy el asistente virtual del ISETA. Preguntame lo que quieras sobre ' +
        'el instituto, sus carreras o sus servicios.',
    };
    chatEl.textInput = {
      placeholder: { text: 'Escribí tu pregunta…' },
    };

    // Scrollbars: styled scrollbar inside the component (shadow DOM) and a
    // scrollable message area within the fixed-panel height.
    chatEl.auxiliaryStyle = [
      '::-webkit-scrollbar { width: 8px; }',
      '::-webkit-scrollbar-track { background: transparent; }',
      '::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.22); border-radius: 6px; }',
      '::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.38); }',
      '* { scrollbar-width: thin; scrollbar-color: rgba(0, 0, 0, 0.28) transparent; }',
    ].join('\n');
    chatEl.requestBodyLimits = { maxMessages: 12 };
    chatEl.errorMessages = {
      displayServiceErrorMessages: true,
    };

    panelBody.innerHTML = '';
    panelBody.appendChild(chatEl);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
