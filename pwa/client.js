(() => {
    'use strict';
    // Keep the same HTML usable when opened directly from disk.
    if (!['http:', 'https:'].includes(location.protocol)) return;
    const install = document.createElement('button');
    install.type = 'button';
    install.className = 'btn no-print';
    install.textContent = 'Install app';
    install.hidden = true;
    document.querySelector('header .controls')?.append(install);
    const status = document.createElement('div');
    status.className = 'footer no-print';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    document.body.append(status);
    let installPrompt;
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPrompt = event;
        install.hidden = false;
    });
    install.addEventListener('click', async () => {
        if (!installPrompt) return;
        install.disabled = true;
        try {
            await installPrompt.prompt();
            await installPrompt.userChoice;
        } finally {
            installPrompt = null;
            install.hidden = true;
            install.disabled = false;
        }
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        install.hidden = true;
    });
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        status.textContent = 'Install and offline caching require HTTPS or localhost. Download the HTML for direct offline use.';
        return;
    }
    window.addEventListener('load', async () => {
        let registration;
        const showStatus = () => {
            if (registration?.waiting) {
                status.textContent = 'Update ready. Save your project, then close all app windows and tabs to apply it.';
            } else if (registration?.active) {
                status.textContent = navigator.onLine ? 'Ready for offline use. Save project JSON to keep your work.' : 'Working offline. Save project JSON to keep your work.';
            }
        };
        try {
            registration = await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
            registration.addEventListener('updatefound', () => {
                registration.installing?.addEventListener('statechange', showStatus);
            });
            await navigator.serviceWorker.ready;
            showStatus();
            window.addEventListener('online', showStatus);
            window.addEventListener('offline', showStatus);
        } catch (error) {
            status.textContent = 'Offline caching is unavailable. You can still use the planner and save your project.';
            console.warn('Planner offline setup failed:', error);
        }
    });
})();
