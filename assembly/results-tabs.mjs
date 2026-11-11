// Results tabs become available only after a successful optimization for the
// current Parts-list SKP import. Presentation stays alive across tab switches.
export function createResultsTabs({ tablist, cuttingPanel, explodedPanel, viewer, onCuttingShown = () => {} }) {
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    let hasModel = false, optimized = false;
    function select(name, focus = false) {
        const enabled = hasModel && optimized;
        const exploded = enabled && name === 'exploded';
        tablist.hidden = !enabled;
        cuttingPanel.hidden = exploded;
        explodedPanel.hidden = !exploded;
        for (const tab of tabs) {
            const active = tab.dataset.resultTab === (exploded ? 'exploded' : 'cutting');
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            if (active && focus) tab.focus();
        }
        viewer?.setActive(exploded);
        if (!exploded) onCuttingShown();
    }
    for (const tab of tabs) {
        tab.addEventListener('click', () => select(tab.dataset.resultTab));
        tab.addEventListener('keydown', event => {
            const index = tabs.indexOf(tab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
            if (next === null || tablist.hidden) return;
            event.preventDefault();
            select(tabs[next].dataset.resultTab, true);
        });
    }
    select('cutting');
    return {
        setModelAvailable(value) { hasModel = !!value; optimized = false; select('cutting'); },
        setOptimized() { optimized = true; select('cutting'); }
    };
}
