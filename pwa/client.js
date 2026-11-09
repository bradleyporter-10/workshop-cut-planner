(() => {
    'use strict';
    if (!['http:', 'https:'].includes(location.protocol)) return;
    const currentVersion = '__APP_VERSION__';
    let publishedVersion = null;
    const isNewerVersion = version => {
        if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
        const a = version.split('.').map(Number), b = currentVersion.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
        return false;
    };
    const standalone = window.matchMedia('(display-mode: standalone)');
    const minimal = window.matchMedia('(display-mode: minimal-ui)');
    let installedEvent = false;
    const isInstalled = () => installedEvent || standalone.matches || minimal.matches || navigator.standalone === true;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const install = document.createElement('button');
    install.type = 'button';
    install.id = 'pwa-install';
    install.className = 'btn no-print';
    install.textContent = 'Install app';
    install.hidden = true;
    document.querySelector('header .controls')?.append(install);
    const panel = document.createElement('div');
    panel.className = 'footer no-print pwa-status-bar';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.id = 'pwa-refresh';
    refresh.className = 'btn no-print';
    refresh.innerHTML = '<svg class="pwa-refresh-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/></svg><span class="pwa-refresh-label">Refresh app</span>';
    refresh.title = 'Check for an update and refresh the app. Save your project first.';
    refresh.disabled = true;
    panel.append(status);
    document.querySelector('header .controls')?.append(refresh);
    document.body.append(panel);
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.className = 'pwa-update-banner no-print';
    banner.setAttribute('role', 'status');
    banner.textContent = 'Update available — save project, then refresh.';
    banner.hidden = true;
    document.body.prepend(banner);
    let installPrompt, registration, lastCheck = 0, checkInProgress, reloadRequested = false;
    let hadController = !!navigator.serviceWorker?.controller;
    const syncInstall = () => { install.hidden = isInstalled() || (!installPrompt && !isIOS); };
    standalone.addEventListener('change', syncInstall);
    minimal.addEventListener('change', syncInstall);
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        if (isInstalled()) return;
        installPrompt = event;
        syncInstall();
    });
    install.addEventListener('click', async () => {
        if (isInstalled()) { syncInstall(); return; }
        if (!installPrompt) {
            if (isIOS) alert('To install on iPhone or iPad: open the browser’s Share menu and choose Add to Home Screen, then Add. If that option is missing, open this page in Safari. Launch the app from its Home Screen icon.');
            return;
        }
        const prompt = installPrompt;
        installPrompt = null;
        install.disabled = true;
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === 'accepted') installedEvent = true;
        } catch (error) {
            alert('The install prompt is unavailable. Use your browser’s menu to install or add this app to your Home Screen.');
        } finally {
            install.disabled = false;
            syncInstall();
        }
    });
    window.addEventListener('appinstalled', () => {
        installedEvent = true;
        installPrompt = null;
        syncInstall();
    });
    syncInstall();
    const showStatus = () => {
        const updateReady = !!(publishedVersion || registration?.waiting);
        banner.textContent = publishedVersion
            ? `Version ${publishedVersion} available — save project, then refresh.`
            : 'Update available — save project, then refresh.';
        refresh.setAttribute('data-update-ready', String(updateReady));
        banner.hidden = !updateReady;
        refresh.title = updateReady
            ? 'Update available. Save your project JSON files before refreshing; unsaved changes will be lost.'
            : 'Check for an update and refresh the app. Save your project files first.';
        refresh.setAttribute('aria-label', refresh.title);
        status.className = updateReady ? 'pwa-update-announcement' : '';
        if (updateReady) {
            status.textContent = '';
        } else if (registration?.active) {
            status.textContent = navigator.onLine ? 'Ready for offline use. Save project JSON to keep your work.' : 'Working offline. Save project JSON to keep your work.';
        }
    };
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        install.hidden = true;
        refresh.hidden = true;
        status.textContent = 'Install and offline caching require HTTPS or localhost. Download the HTML for direct offline use.';
        return;
    }
    async function checkForUpdate(force = false) {
        if (!registration || !navigator.onLine) return;
        if (checkInProgress) return checkInProgress;
        if (!force && Date.now() - lastCheck < 60000) return;
        lastCheck = Date.now();
        checkInProgress = (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            try {
                const url = new URL('./version.json', location.href);
                url.searchParams.set('__check', String(Date.now()));
                const response = await fetch(url.href, {cache: 'no-store', signal: controller.signal});
                if (response.ok) {
                    const release = await response.json();
                    if (typeof release.version === 'string' && isNewerVersion(release.version)) {
                        publishedVersion = release.version;
                        showStatus();
                    }
                }
            } catch (error) {
                // A failed/offline release check must not disrupt the plan.
            } finally { clearTimeout(timeout); }
            await registration.update();
        })();
        try { await checkInProgress; }
        finally { checkInProgress = null; showStatus(); }
    }
    function waitForInstall(worker) {
        if (!worker || worker.state === 'installed' || worker.state === 'activated') return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = error => { clearTimeout(timer); worker.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
            const changed = () => {
                if (worker.state === 'installed' || worker.state === 'activated') finish();
                else if (worker.state === 'redundant') finish(new Error('Update installation failed.'));
            };
            const timer = setTimeout(() => finish(new Error('Update download timed out. Try again when online.')), 20000);
            worker.addEventListener('statechange', changed);
            changed();
        });
    }
    function refreshPage() {
        if (!navigator.onLine) { location.reload(); return; }
        const url = new URL(location.href);
        url.searchParams.set('__app_version', publishedVersion || currentVersion);
        url.searchParams.set('__refresh', String(Date.now()));
        location.replace(url.href);
    }
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'APP_VERSION' && typeof event.data.version === 'string' && isNewerVersion(event.data.version)) {
            publishedVersion = event.data.version;
            showStatus();
        }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadRequested) refreshPage();
        else if (hadController) checkForUpdate(true).catch(() => {});
        hadController = true;
    });
    refresh.addEventListener('click', async () => {
        if (!confirm('Refresh the app? Save your project JSON first. Unsaved changes will be lost.')) return;
        refresh.disabled = true;
        let activationTimer;
        try {
            if (navigator.onLine) await checkForUpdate(true);
            await waitForInstall(registration?.installing);
            if (registration?.waiting) {
                reloadRequested = true;
                registration.waiting.postMessage({type: 'SKIP_WAITING'});
                activationTimer = setTimeout(() => {
                    reloadRequested = false;
                    refresh.disabled = false;
                    status.textContent = 'The update could not activate. Save your project, close all app windows, and reopen.';
                }, 15000);
                navigator.serviceWorker.addEventListener('controllerchange', () => clearTimeout(activationTimer), {once: true});
            } else {
                refreshPage();
            }
        } catch (error) {
            reloadRequested = false;
            refresh.disabled = false;
            status.textContent = 'Could not check or apply updates. Your current plan is still open. Try again when online.';
            console.warn('Planner update failed:', error);
        }
    });
    const start = async () => {
        try {
            registration = await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
            registration.addEventListener('updatefound', () => {
                registration.installing?.addEventListener('statechange', showStatus);
            });
            await navigator.serviceWorker.ready;
            refresh.disabled = false;
            showStatus();
            checkForUpdate().catch(() => {});
            window.addEventListener('online', () => {showStatus();checkForUpdate(true).catch(() => {});});
            window.addEventListener('offline', showStatus);
            window.addEventListener('focus', () => checkForUpdate(true).catch(() => {}));
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {syncInstall();checkForUpdate().catch(() => {});}
            });
            setInterval(() => {if (!document.hidden) checkForUpdate().catch(() => {});}, 60000);
        } catch (error) {
            status.textContent = 'Offline caching is unavailable. You can still use the planner and save your project.';
            console.warn('Planner offline setup failed:', error);
        }
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, {once: true});
})();
