window.__ModuleLoader__.load({
  id: 'dsh-ds-hub',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');

    let open = false;
    let restoreFocus = null;
    const listeners = new Set();
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const snapshot = () => open;
    const setOpen = (value) => {
      open = Boolean(value);
      for (const listener of listeners) listener();
    };
    function Overlay() {
      const isOpen = React.useSyncExternalStore(subscribe, snapshot);
      const closeRef = React.useRef(null);
      React.useEffect(() => {
        if (!isOpen) return undefined;
        closeRef.current?.focus?.();
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          setOpen(false);
        };
        const onMessage = (event) => {
          if (event.origin === window.location.origin && event.data?.type === 'ds-hub/close') setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('message', onMessage);
        return () => {
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('message', onMessage);
          restoreFocus?.focus?.();
          restoreFocus = null;
        };
      }, [isOpen]);
      if (!isOpen) return null;
      return React.createElement('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'DS Hub',
        style: {
          position: 'absolute',
          inset: 0,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--dsw-alias-bg-base, #f5f7fb)',
        },
      }, [
        React.createElement('div', {
          key: 'bar',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 44,
            padding: '6px 12px 6px 16px',
            flex: '0 0 auto',
            color: 'var(--dsw-alias-label-primary, #172033)',
            background: 'var(--dsw-specific-sidebar-fill, #fff)',
            borderBottom: '1px solid var(--dsw-alias-border-l2, #dfe5ef)',
          },
        }, [
          React.createElement('span', {
            key: 'title',
            style: { fontSize: 13, fontWeight: 650, letterSpacing: '.01em' },
          }, 'DS Hub · Agent 能力中心'),
          React.createElement('button', {
            key: 'close',
            ref: closeRef,
            type: 'button',
            onClick: () => setOpen(false),
            title: '关闭 DS Hub',
            'aria-label': '关闭 DS Hub',
            style: {
              width: 32,
              height: 32,
              border: '1px solid var(--dsw-alias-border-l2, #dfe5ef)',
              borderRadius: 9,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            },
          }, '✕'),
        ]),
        React.createElement('iframe', {
          key: 'frame',
          title: 'DS Hub',
          src: '/ds-hub/',
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox',
          referrerPolicy: 'no-referrer',
          style: {
            flex: 1,
            minHeight: 0,
            width: '100%',
            border: 0,
            background: '#f5f7fb',
          },
        }),
      ]);
    }

    function FooterAction() {
      const isOpen = React.useSyncExternalStore(subscribe, snapshot);
      return React.createElement('button', {
        type: 'button',
        onClick: (event) => {
          if (isOpen) setOpen(false);
          else {
            restoreFocus = event.currentTarget;
            setOpen(true);
          }
        },
        title: '打开 DS Hub',
        'aria-label': '打开 DS Hub',
        'aria-pressed': isOpen,
        style: {
          display: 'grid',
          placeItems: 'center',
          width: 34,
          height: 34,
          borderRadius: 10,
          border: `1px solid ${isOpen ? 'var(--dsw-alias-state-accent, #4f7cff)' : 'transparent'}`,
          background: isOpen ? 'var(--dsw-alias-interactive-bg-hover, rgba(79,124,255,.12))' : 'transparent',
          color: 'var(--dsw-alias-label-secondary, #667085)',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 750,
          letterSpacing: '-.04em',
        },
      }, isOpen ? '✕' : 'DS');
    }

    const inject = ['slots'];
    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'ds-hub',
      }, Overlay));
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'ds-hub',
      }, FooterAction));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
