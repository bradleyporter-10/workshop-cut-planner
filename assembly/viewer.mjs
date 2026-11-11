import * as THREE from 'three';
import { assemblyViews, presetDirection, partShade } from './view-presets.mjs';
import { buildOriginGuides } from './origin-guides.mjs';
import { fitCameraToPoints } from './camera-fit.mjs';
import { createReferenceView } from './reference-view.mjs';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { planExplosion, subtreeBounds } from './explosion.mjs';
import { correctionToWorld, correctionInAxes, isManualTarget, presentationOffsets } from './manual-offsets.mjs';
import { buildPartCatalog, formatMeasurement, summarizeParts } from './annotations.mjs';
import { createAnnotationLayer } from './annotation-layer.mjs';
export { optimizationLetters } from './annotations.mjs';
export { createResultsTabs } from './results-tabs.mjs';
export { normalizeAssembly } from './model.mjs';

export function createViewer(section) {
    const find = role => section.querySelector(`[data-assembly="${role}"]`);
    const host = find('viewport');
    const tree = find('tree');
    const status = find('status');
    const info = find('info');
    let model = null, scene, renderer, camera, controls, content, selected = null;
    let projection = 'perspective';
    let explosionPlan = null, explosionAmount = 0;
    const manualLayouts = new Map(), viewSettings = new Map();
    let geometryCache = new Map(), edgeCache = new Map(), referenceView;
    let groupedViews = [], viewByInstance = new Map();
    const canonicalViewId = id => viewByInstance.get(id)?.id || id;
    const corrections = () => manualLayouts.get(explosionPlan?.assemblyId) || new Map();
    const presentations = new Map();
    const objects = new Map(), meshes = [], resources = new Set();
    const buttons = new Map();
    const raycaster = new THREE.Raycaster();
    let pointerStart, annotationLayer;
    let viewWidth = 0, viewHeight = 0;
    let partCatalog = new Map(), partsListSignature = '';
    const precision = () => Number(find('precision').value);
    function draw() {
        if (renderer && !section.hidden) {
            renderer.render(scene, camera);
            annotationLayer?.update({ model, catalog: partCatalog, meshes, objects, camera, selected,
                labelMode: explosionPlan ? find('labels').value : 'none', leaders: find('leaders').checked,
                originGuides:find('origin-guides').checked ? buildOriginGuides(model,presentationOffsets(model,explosionPlan,explosionAmount,corrections()),objects) : [] });
            const referenceId = explosionPlan?.assemblyId || model?.rootId;
            const overview = referenceId === model?.rootId;
            find('reference').hidden = overview;
            find('reference-caption').hidden = overview;
            const subassemblies = find('subassemblies');
            subassemblies.hidden = !overview;
            if (overview) {
                find('reference-title').textContent = 'Subassemblies';
                const signature = groupedViews.map(view=>view.label).join('\n');
                if (subassemblies.dataset.signature !== signature) {
                    subassemblies.replaceChildren(...groupedViews.filter(view=>view.id!==model.rootId).map(view=>{
                        const item=document.createElement('li'); item.textContent=view.label.replace(' · Build ×',' ×'); return item;
                    }));
                    subassemblies.dataset.signature = signature;
                }
            }
            referenceView?.update({ model, geometries: geometryCache, edges: edgeCache, activeId: referenceId, activeIds:viewByInstance.get(referenceId)?.memberIds || [referenceId] });
        }
    }
    function resize(refit = true) {
        if (!renderer || section.hidden) return;
        const width = host.clientWidth, height = host.clientHeight;
        if (width <= 0 || height <= 0) return; // Print CSS can temporarily hide the active panel.
        const changed = width !== viewWidth || height !== viewHeight;
        viewWidth = width; viewHeight = height;
        if (refit && changed && content) { fit(); return; }
        renderer.setSize(width, height);
        const aspect = width / height;
        if (camera.isPerspectiveCamera) camera.aspect = aspect;
        else {
            camera.left = -camera.userData.span * aspect / 2;
            camera.right = camera.userData.span * aspect / 2;
        }
        camera.updateProjectionMatrix();
        draw();
    }
    function initialize() {
        if (renderer) return true;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch {
            status.textContent = '3D rendering is unavailable. Enable WebGL in your browser. The assembly tree and cut planner are still available.';
            return false;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.setAttribute('aria-label', '3D assembly. Drag to orbit; right-drag to pan; scroll to zoom. Touch: one finger orbits, two fingers pan and zoom.');
        host.replaceChildren(renderer.domElement);
        annotationLayer = createAnnotationLayer(host, renderAnnotationSummary);
        referenceView = createReferenceView(find('reference'), find('reference-caption'), find('reference-title'));
        new ResizeObserver(() => { if (!section.hidden) draw(); }).observe(find('reference'));
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#fcfdff');
        scene.add(new THREE.HemisphereLight(0xffffff, 0x655b4b, 1.7));
        const light = new THREE.DirectionalLight(0xfff3db, 2.7);
        light.position.set(1, -2, 3);
        scene.add(light);
        setCamera();
        host.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
        host.addEventListener('pointerup', event => {
            if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
            const rect = host.getBoundingClientRect();
            raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
            const hit = raycaster.intersectObjects(meshes, false).find(hit => {
                let object = hit.object;
                while (object) { if (!object.visible) return false; object = object.parent; }
                return true;
            });
            if (hit) select(hit.object.userData.instanceId);
        });
        new ResizeObserver(() => resize(true)).observe(host);
        return true;
    }
    function setCamera() {
        const previous = camera;
        const target = controls?.target.clone() || new THREE.Vector3();
        controls?.dispose();
        camera = projection === 'perspective' ? new THREE.PerspectiveCamera(40, 1, .01, 1000000)
            : new THREE.OrthographicCamera(-100, 100, 100, -100, .01, 1000000);
        camera.up.set(0, 0, 1); // SketchUp uses Z up; keep the model in its original axes.
        camera.userData.span = 200;
        camera.position.copy(previous?.position || new THREE.Vector3(200, -300, 200));
        controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(target);
        controls.addEventListener('change', draw);
        controls.update();
        resize();
    }
    function fit(id = explosionPlan && find('isolate').checked ? explosionPlan.assemblyId : model?.rootId, isometric = false) {
        const object = objects.get(id);
        if (!object || !renderer) return;
        scene.updateMatrixWorld(true);
        const points = [];
        function includeVisible(group) {
            if (!group.visible) return;
            if (group.geometry && !group.isLineSegments) {
                if (!group.geometry.boundingBox) group.geometry.computeBoundingBox();
                const bounds = group.geometry.boundingBox;
                for (let corner=0;corner<8;corner++) points.push(new THREE.Vector3(...[0,1,2].map(axis=>(corner&(1<<axis)) ? bounds.max.toArray()[axis] : bounds.min.toArray()[axis])).applyMatrix4(group.matrixWorld));
            }
            group.children.forEach(includeVisible);
        }
        includeVisible(object);
        if (find('origin-guides').checked && explosionPlan) {
            for (const guide of buildOriginGuides(model,presentationOffsets(model,explosionPlan,explosionAmount,corrections()),objects)) points.push(new THREE.Vector3(...guide.from));
        }
        if (!points.length) return;
        const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
        const preset = presetDirection(model, id, find('view-preset').value);
        const direction = isometric ? preset.direction : camera.position.clone().sub(controls.target).normalize();
        if (isometric) {
            const transform = new THREE.Matrix4().set(...model.nodes.get(id).worldMatrix.flat());
            camera.up.copy(new THREE.Vector3(...(find('view-preset').value === 'top' ? [0,1,0] : [0,0,1])).transformDirection(transform));
            find('view-note').textContent = preset.name + ' · one level of child components';
        }
        camera.position.copy(center).addScaledVector(direction,Math.max(new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length(),1)*2);
        camera.lookAt(center); camera.updateMatrixWorld(true);
        const margin = !explosionPlan || find('labels').value === 'none' ? 14 : Math.max(56,Math.min(76,Math.min(host.clientWidth,host.clientHeight)*.12));
        const frame = fitCameraToPoints(camera,points,host.clientWidth,host.clientHeight,margin);
        if (!frame) return;
        controls.target.copy(frame.center); controls.update();
        camera.userData.framing = {padding:frame.padding,width:frame.width,height:frame.height};
        resize(false);
    }
    function select(id) {
        selected = id;
        updateExplosionControls();
        const node = model.nodes.get(id);
        const descendants = new Set();
        function collect(key) { descendants.add(key); model.nodes.get(key).children.forEach(collect); }
        collect(id);
        for (const mesh of meshes) {
            mesh.material.emissive.set(descendants.has(mesh.userData.instanceId) ? '#201500' : '#000000');
            for (const edge of mesh.children) edge.material.color.set(descendants.has(mesh.userData.instanceId) ? '#a96515' : '#554d40');
        }
        for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
        updateSelectionInfo();
        if (node.children.length) fit(id);
        draw();
    }
    function buildTree() {
        tree.replaceChildren();
        buttons.clear();
        if (!model) return;
        function branch(id) {
            const node = model.nodes.get(id);
            const wrapper = document.createElement(node.children.length ? 'details' : 'div');
            wrapper.className = 'assembly-branch';
            if (node.children.length) wrapper.open = id === model.rootId;
            const row = document.createElement(node.children.length ? 'summary' : 'div');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox'; checkbox.checked = true;
            checkbox.setAttribute('aria-label', `Show ${node.name}`);
            checkbox.addEventListener('click', event => event.stopPropagation());
            checkbox.addEventListener('change', () => {
                const object = objects.get(id);
                if (object) object.visible = checkbox.checked;
                draw();
            });
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = partCatalog.has(id) ? `${partCatalog.get(id).number} · ${node.name}` : node.name;
            button.dataset.instanceId = id;
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', event => { event.preventDefault(); select(id); });
            buttons.set(id, button);
            row.append(checkbox, button); wrapper.append(row);
            node.children.forEach(child => wrapper.append(branch(child)));
            return wrapper;
        }
        tree.append(branch(model.rootId));
    }
    function release() {
        referenceView?.clear();
        if (content) scene.remove(content);
        for (const resource of resources) resource.dispose();
        resources.clear(); objects.clear(); presentations.clear(); meshes.length = 0;
        content = null;
        annotationLayer?.clear();
    }
    function buildScene() {
        if (!renderer || !model) return;
        release();
        const geometries = new Map();
        geometryCache = geometries; edgeCache = new Map();
        for (const [id, def] of model.definitions) {
            let geometry;
            if (def.geometry.length) {
                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(def.geometry, 3));
                geometry.computeVertexNormals();
            } else if (def.bounds) {
                const spans = def.bounds.max.map((v, i) => v - def.bounds.min[i]);
                geometry = new THREE.BoxGeometry(...spans);
                geometry.translate(...def.bounds.max.map((v, i) => (v + def.bounds.min[i]) / 2));
            }
            if (geometry) {
                geometries.set(id, geometry); resources.add(geometry);
                const edges = new THREE.EdgesGeometry(geometry, 30); edgeCache.set(id, edges); resources.add(edges);
            }
        }
        function branch(id) {
            const node = model.nodes.get(id), group = new THREE.Group();
            const presentation = new THREE.Group();
            presentation.add(group);
            presentations.set(id, presentation);
            group.matrixAutoUpdate = false;
            group.matrix.set(...node.localMatrix.flat());
            objects.set(id, group);
            const geometry = geometries.get(node.definitionId);
            if (geometry) {
                const def = model.definitions.get(node.definitionId);
                const material = new THREE.MeshStandardMaterial({ color: def.representation === 'mesh' ? partShade(partCatalog.get(id) || id) : '#91b7ce', roughness: .95, flatShading: true, side: THREE.DoubleSide, wireframe: def.representation !== 'mesh' });
                resources.add(material);
                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.instanceId = id;
                mesh.userData.exact = def.representation === 'mesh';
                const edgeMaterial = new THREE.LineBasicMaterial({ color: '#554d40', transparent: true, opacity: .8 });
                resources.add(edgeMaterial);
                mesh.add(new THREE.LineSegments(edgeCache.get(node.definitionId), edgeMaterial));
                group.add(mesh); meshes.push(mesh);
            }
            node.children.forEach(child => group.add(branch(child)));
            return presentation;
        }
        content = branch(model.rootId);
        scene.add(content);
        applyExplosion();
        scene.updateMatrixWorld(true);
        updateShading();
        fit(explosionPlan?.assemblyId || model.rootId, true);
    }
    function setModel(next) {
        model = next; selected = null;
        groupedViews = assemblyViews(model);
        viewByInstance = new Map(groupedViews.flatMap(view=>view.memberIds.map(id=>[id,view])));
        partCatalog = buildPartCatalog(model);
        partsListSignature = '';
        renderAnnotationSummary({ visibleParts: [], labels: 0, dimensions: 0, labelTotal: 0, dimensionTotal: 0 });
        for (const role of ['labels', 'precision', 'leaders']) find(role).disabled = !model;
        explosionPlan = null; explosionAmount = 0;
        manualLayouts.clear(); viewSettings.clear();
        find('layout').value = 'logical';
        for (const axis of ['x','y','z']) find('spread-' + axis).value = '1';
        find('view-preset').value = 'auto';
        find('manual-axes').value = 'assembly';
        find('manual-step').value = '1';
        find('spacing').value = '1';
        find('direction').value = 'auto';
        find('isolate').checked = true;
        find('origin-guides').checked = true;
        updateExplosionControls();
        if (renderer) release();
        info.textContent = 'Select a component to highlight it. Measurements are in the part summary table.';
        status.textContent = model ? (model.issues.length ? `${model.issues.length} model items need review.` : '')
            : 'Import a SketchUp file in Parts list, then optimize to see Assembly Plan. CSV, example parts, and saved cut-list projects do not contain 3D geometry.';
        const notes = find('notes');
        notes.replaceChildren();
        if (model?.issues.length) {
            const summary = document.createElement('summary'); summary.textContent = 'Geometry and hierarchy review notes'; notes.append(summary);
            const text = document.createElement('p'); text.textContent = model.issues.slice(0, 100).join('\n'); notes.append(text);
        }
        buildTree(); buildViewBanner();
        if (!section.hidden && model && initialize()) buildScene();
        draw();
    }
    function setOptimizationLabels(labels) {
        partCatalog = new Map(Array.from(partCatalog, ([id, part]) => [id, { ...part, optimizationLabel: labels.get(id) || '' }]));
        partsListSignature = '';
        updateSelectionInfo();
        updateShading();
    }
    function updateSelectionInfo() {
        const node = model?.nodes.get(selected);
        if (!node) return;
        const part = partCatalog.get(selected);
        info.textContent = `${part ? (part.optimizationLabel ? part.optimizationLabel + ' · ' : '') + part.number + ' · ' : ''}${node.name}${part ? '' : ' · Assembly'}${node.sheared ? ' · Sheared: dimensions follow scaled local axes' : ''}`;
    }
    function renderAnnotationSummary(summary) {
        const { visibleParts, labels, labelTotal } = summary;
        const summaryText = !model ? 'Import a SketchUp model to add component callouts.'
            : `${labels} of ${labelTotal} labels shown. Measurements are in the part summary table, rounded to the nearest 1/${precision()} inch. Labels without clear space are omitted rather than covering geometry.${find('labels').value === 'optimization' ? ' Letters match the cutting layouts; — marks geometry without a cut-plan letter.' : ''}`;
        if (find('annotation-status').textContent !== summaryText) find('annotation-status').textContent = summaryText;
        const signature = JSON.stringify([precision(), explosionPlan?.assemblyId, visibleParts.map(part => part.instanceId)]);
        if (signature === partsListSignature) return;
        partsListSignature = signature;
        const rows = summarizeParts(visibleParts);
        find('parts-summary').textContent = `Part summary${explosionPlan && find('isolate').checked ? ` · Build ×${viewByInstance.get(explosionPlan.assemblyId)?.count || 1}` : ''}`;
        const list = find('parts-list'); list.replaceChildren();
        for (const part of rows) {
            const row = document.createElement('tr');
            row.dataset.partInstances = JSON.stringify(part.instanceIds);
            row.dataset.optimizationLetter = part.letter;
            row.dataset.quantity = String(part.quantity);
            const values = [`${part.letter || '—'} · ${part.name}`, String(part.quantity),
                ...part.dimensions.map(value => formatMeasurement(value, precision()))];
            values.forEach((value, index) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                cell.dataset.label = ['Part', 'Qty', 'Length (in)', 'Width (in)', 'Thickness (in)'][index];
                row.append(cell);
            });
            list.append(row);
        }
    }
    for (const role of ['labels', 'precision', 'leaders']) {
        find(role).addEventListener('change', () => { updateSelectionInfo(); draw(); });
    }
    function updateExplosionControls(message) {
        const target = model?.nodes.get(selected || model?.rootId);
        find('explode').disabled = !target?.children.length;
        find('amount').disabled = !explosionPlan;
        find('spacing').disabled = !model;
        find('direction').disabled = !model;
        for (const role of ['layout','spread-x','spread-y','spread-z','view-preset','rotate-view','shading','edges']) find(role).disabled = !model;
        find('restore').disabled = !explosionPlan;
        find('isolate').disabled = !explosionPlan;
        find('origin-guides').disabled = !explosionPlan;
        find('amount').value = String(explosionAmount);
        find('amount-value').textContent = `${explosionAmount}%`;
        find('explosion-status').textContent = message || (explosionPlan
            ? `${model.nodes.get(explosionPlan.assemblyId).name} · Build ×${viewByInstance.get(explosionPlan.assemblyId)?.count || 1}: ${explosionPlan.offsets.size} immediate children · ${explosionAmount}% exploded.${find('isolate').checked ? ' Other assemblies hidden.' : ''}${explosionPlan.plane ? ` Planar ${explosionPlan.plane} spread; parts stay in their original plane.` : ''}${explosionPlan.skipped ? ` ${explosionPlan.skipped} empty children skipped.` : ''}`
            : target?.children.length ? `Ready to explode ${target.name}, one hierarchy level.`
                : 'Select an assembly in the tree to explode its immediate children.');
        updateManualControls();
        updateViewBanner();
    }
    function updateManualControls(message) {
        const eligible = !!explosionPlan && isManualTarget(model, explosionPlan.assemblyId, selected) && !subtreeBounds(model, selected).isEmpty();
        let values = [0, 0, 0], error;
        if (eligible) {
            try { values = correctionInAxes(model, explosionPlan.assemblyId, selected, find('manual-axes').value, corrections().get(selected)); }
            catch (failure) { error = failure.message; }
        }
        const enabled = eligible && !error;
        for (const role of ['manual-axes', 'manual-step', 'manual-apply']) find(role).disabled = !enabled;
        for (const [i, axis] of ['x', 'y', 'z'].entries()) {
            const field = find('manual-' + axis);
            field.disabled = !enabled;
            field.value = String(Number(values[i].toFixed(6)));
        }
        for (const button of section.querySelectorAll('[data-manual-jog]')) button.disabled = !enabled;
        find('manual-reset-part').disabled = !eligible || !corrections().has(selected);
        find('manual-reset-assembly').disabled = !corrections().size;
        const part = partCatalog.get(selected);
        const name = part ? `${part.optimizationLabel || part.number} · ${part.name}` : model?.nodes.get(selected)?.name;
        find('manual-status').textContent = message || error || (enabled
            ? `${name}: corrections at 100% explosion, in inches. Currently shown at ${explosionAmount}%. ${corrections().size} custom correction(s) in this assembly.`
            : 'Explode an assembly, then select a part or nested assembly inside it to adjust.');
    }
    function commitManual(values) {
        try {
            const offset = correctionToWorld(model, explosionPlan?.assemblyId, selected, find('manual-axes').value, values);
            const next = new Map(corrections());
            if (offset.every(value => value === 0)) next.delete(selected);
            else next.set(selected, offset);
            // Validate the entire presentation before committing any state.
            presentationOffsets(model, explosionPlan, explosionAmount, next);
            manualLayouts.set(explosionPlan.assemblyId, next);
            applyExplosion();
            updateManualControls();
        } catch (error) {
            find('manual-status').textContent = error.message;
        }
    }
    find('manual-axes').addEventListener('change', () => updateManualControls());
    find('manual-apply').onclick = () => {
        const fields = ['x', 'y', 'z'].map(axis => find('manual-' + axis));
        if (fields.some(field => field.value.trim() === '' || !field.validity.valid)) {
            find('manual-status').textContent = 'Enter finite X, Y, and Z corrections in inches.';
            return;
        }
        commitManual(fields.map(field => Number(field.value)));
    };
    for (const button of section.querySelectorAll('[data-manual-jog]')) {
        button.onclick = () => {
            const step = Number(find('manual-step').value);
            if (!Number.isFinite(step) || step <= 0) {
                find('manual-status').textContent = 'Enter a positive movement step in inches.';
                return;
            }
            try {
                const values = correctionInAxes(model, explosionPlan.assemblyId, selected, find('manual-axes').value, corrections().get(selected));
                const [axis, direction] = button.dataset.manualJog.split(':').map(Number);
                values[axis] += step * direction;
                commitManual(values);
            } catch (error) { find('manual-status').textContent = error.message; }
        };
    }
    find('manual-reset-part').onclick = () => {
        corrections().delete(selected);
        applyExplosion(); updateManualControls();
    };
    find('manual-reset-assembly').onclick = () => {
        manualLayouts.delete(explosionPlan?.assemblyId);
        applyExplosion(); updateManualControls();
    };
    function applyExplosion() {
        const scope = explosionPlan && find('isolate').checked ? explosionPlan.assemblyId : null;
        for (const [id, presentation] of presentations) {
            presentation.position.set(0, 0, 0);
            presentation.visible = !scope || id === scope || id.startsWith(scope + '/') || scope.startsWith(id + '/');
        }
        // Ancestor groups must stay visible, but their own geometry must not
        // obscure the isolated descendant. Manual visibility stays on original groups.
        for (const mesh of meshes) {
            const id = mesh.userData.instanceId;
            mesh.visible = !scope || id === scope || id.startsWith(scope + '/');
        }
        for (const [id, offset] of presentationOffsets(model, explosionPlan, explosionAmount, corrections())) {
            presentations.get(id)?.position.set(...offset);
        }
        scene?.updateMatrixWorld(true);
        draw();
    }
    function explode(recalculate = false, targetId = null, remember = true) {
        if (!model) return;
        const requested = targetId || (recalculate ? explosionPlan?.assemblyId : selected || model.rootId);
        const target = canonicalViewId(requested);
        if (!target) return;
        try {
            const next = planExplosion(model, target, { spacing: Number(find('spacing').value), direction: find('direction').value, layout: find('layout').value, spread: ['x','y','z'].map(axis => Number(find('spread-' + axis).value)) });
            if (remember && !recalculate && explosionPlan?.assemblyId !== target) saveView();
            explosionPlan = next;
            if (!recalculate) explosionAmount = 50;
            applyExplosion();
            updateExplosionControls();
            if (!recalculate && requested !== target) select(target);
            fit(target, !recalculate);
        } catch (error) {
            updateExplosionControls(error.message);
        }
    }
    find('explode').onclick = () => explode();
    find('amount').addEventListener('input', event => {
        explosionAmount = Number(event.target.value);
        applyExplosion();
        updateExplosionControls();
        fit();
    });
    find('isolate').addEventListener('change', () => { applyExplosion(); updateExplosionControls(); fit(); });
    find('spacing').addEventListener('change', () => { if (explosionPlan) explode(true); });
    find('direction').addEventListener('change', () => { if (explosionPlan) explode(true); });
    for (const role of ['layout','spread-x','spread-y','spread-z']) {
        find(role).addEventListener('change', () => { if (explosionPlan) explode(true); });
    }
    find('restore').onclick = () => {
        explosionPlan = null; explosionAmount = 0;
        manualLayouts.clear();
        applyExplosion();
        updateExplosionControls();
        fit(selected && model.nodes.get(selected).children.length ? selected : model?.rootId);
    };
    function updateShading() {
        for (const mesh of meshes) {
            mesh.material.color.set(mesh.userData.exact ? (find('shading').checked ? partShade(partCatalog.get(mesh.userData.instanceId) || mesh.userData.instanceId) : '#eadbc0') : '#91b7ce');
            for (const edge of mesh.children) edge.visible = find('edges').checked;
        }
        draw();
    }
    find('shading').addEventListener('change', updateShading);
    find('edges').addEventListener('change', updateShading);
    find('origin-guides').addEventListener('change', draw);
    function updateViewBanner() {
        const activeId = explosionPlan?.assemblyId || model?.rootId;
        for (const tab of find('views').querySelectorAll('[role=tab]')) {
            const active = tab.dataset.assemblyView === canonicalViewId(activeId);
            tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
        }
    }
    function buildViewBanner() {
        find('views').replaceChildren();
        for (const view of groupedViews) addViewTab(view.id, view.label, view.level);
        updateViewBanner();
    }
    function addViewTab(id, label, level = 0) {
        const tab = document.createElement('button');
        tab.type = 'button'; tab.className = 'assembly-view-tab' + (level ? ' assembly-child-view' : ''); tab.textContent = (level ? '↳ ' : '') + label;
        tab.setAttribute('role','tab'); tab.setAttribute('aria-controls','assembly-drawing');
        tab.dataset.assemblyView = id;
        tab.onclick = () => activateView(id);
        tab.addEventListener('keydown', event => {
            const tabs = [...find('views').querySelectorAll('[role=tab]')], index = tabs.indexOf(tab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
            if (next !== null) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
        });
        find('views').append(tab);
    }
    function saveView() {
        if (!model) return;
        const id = explosionPlan?.assemblyId || model.rootId;
        const options = {};
        for (const role of ['spacing','direction','layout','spread-x','spread-y','spread-z','view-preset','projection','labels','precision']) options[role] = find(role).value;
        options.selection = selected && (selected === id || selected.startsWith(id + '/')) ? selected : id;
        options.hidden = [...objects].filter(([,object])=>!object.visible).map(([key])=>key);
        options.checks = Object.fromEntries(['leaders','shading','edges','origin-guides'].map(role=>[role,find(role).checked]));
        options.amount = explosionAmount;
        options.isolate = find('isolate').checked;
        if (camera) options.camera = { position:camera.position.toArray(), target:controls.target.toArray(), up:camera.up.toArray(), zoom:camera.zoom, span:camera.userData.span };
        viewSettings.set(id, options);
    }
    function activateView(id) {
        id = canonicalViewId(id);
        if (!model?.nodes.has(id)) return;
        saveView();
        const saved = viewSettings.get(id);
        const options = saved || { spacing:'1', direction:'auto', layout:'logical', 'spread-x':'1', 'spread-y':'1', 'spread-z':'1', 'view-preset':'auto', projection:'orthographic', amount:50, isolate:true };
        for (const role of ['spacing','direction','layout','spread-x','spread-y','spread-z','view-preset','projection','labels','precision']) if (options[role] !== undefined) find(role).value = options[role];
        find('isolate').checked = options.isolate;
        for (const role of ['leaders','shading','edges','origin-guides']) if (options.checks) find(role).checked = options.checks[role];
        const hidden = new Set(options.hidden || []);
        for (const [key,object] of objects) {
            object.visible = !hidden.has(key);
            const checkbox = buttons.get(key)?.parentElement.querySelector('input');
            if (checkbox) checkbox.checked = object.visible;
        }
        if (projection !== find('projection').value) { projection = find('projection').value; if (renderer) setCamera(); }
        selected = id;
        if (id === model.rootId) {
            explosionPlan = null; explosionAmount = 0; applyExplosion(); select(id); fit(id,true);
        } else {
            // The banner can also include a nested assembly reached through the tree.
            if (![...find('views').children].some(tab => tab.dataset.assemblyView === id)) addViewTab(id, model.nodes.get(id).name);
            explode(false,id,false);
            explosionAmount = options.amount; applyExplosion(); select(id); fit(id,true);
        }
        if (saved?.selection && model.nodes.has(saved.selection)) select(saved.selection);
        updateShading();
        if (saved?.camera && camera) {
            camera.position.fromArray(saved.camera.position); controls.target.fromArray(saved.camera.target); camera.up.fromArray(saved.camera.up);
            camera.zoom = saved.camera.zoom; camera.userData.span = saved.camera.span;
            if (camera.isOrthographicCamera) { camera.top = camera.userData.span / 2; camera.bottom = -camera.userData.span / 2; }
            controls.update(); resize();
        }
        updateExplosionControls(); draw();
    }
    find('view-preset').addEventListener('change', () => fit(explosionPlan?.assemblyId || selected || model?.rootId,true));
    find('rotate-view').onclick = () => {
        if (!camera) return;
        const direction = camera.position.clone().sub(controls.target).applyAxisAngle(camera.up.clone().normalize(),Math.PI);
        camera.position.copy(controls.target).add(direction); controls.update(); draw();
        find('view-note').textContent = 'View rotated 180° · source geometry unchanged';
    };
    function setActive(active) {
        section.hidden = !active;
        if (active && model && initialize()) {
            if (!content) buildScene();
            resize();
        }
    }
    async function createPrintPages() {
        if (!model) throw Error('Import and optimize a SketchUp model first.');
        const wasHidden = section.hidden;
        const currentId = explosionPlan?.assemblyId || model.rootId;
        saveView();
        const savedSettings = new Map(viewSettings);
        const layout = section.querySelector('.assembly-layout');
        const styled = [section,layout,host].map(element=>[element,element.getAttribute('style')]);
        const pages = [];
        try {
            // Use a consistent desktop-sized drawing, including on phones.
            section.style.width = '1200px'; section.style.maxWidth = 'none';
            layout.style.gridTemplateColumns = 'minmax(0,1.65fr) minmax(0,1fr)';
            host.style.height = '560px';
            setActive(true);
            for (const view of groupedViews) {
                activateView(view.id);
                await new Promise(resolve => requestAnimationFrame(resolve));
                // Saved camera framing belongs to the on-screen viewport.
                // Refit at export dimensions while keeping its viewing direction.
                fit(view.id);
                draw();
                const image = renderer.domElement.toDataURL('image/png');
                const overlay = host.querySelector('.assembly-annotations').cloneNode(true);
                overlay.setAttribute('xmlns','http://www.w3.org/2000/svg');
                overlay.setAttribute('width',renderer.domElement.width);
                overlay.setAttribute('height',renderer.domElement.height);
                const summaryTable = find('parts-list').closest('table').cloneNode(true);
                summaryTable.querySelectorAll('th').forEach((cell,index)=>{cell.textContent=['Part','Qty','L (in)','W (in)','T (in)'][index];});
                pages.push({
                    title: view.label,
                    image,
                    callouts: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(overlay)),
                    parent: find('reference-title').textContent,
                    reference: view.id === model.rootId ? null : referenceView.snapshot(),
                    caption: find('reference-caption').textContent,
                    subassemblies: view.id === model.rootId ? groupedViews.filter(item=>item.id!==model.rootId).map(item=>item.label) : [],
                    summary: view.id === model.rootId ? '' : summaryTable.outerHTML
                });
            }
            return pages;
        } finally {
            for (const [element,style] of styled) {
                if (style === null) element.removeAttribute('style'); else element.setAttribute('style',style);
            }
            viewSettings.clear(); savedSettings.forEach((value,key)=>viewSettings.set(key,value));
            activateView(currentId);
            viewSettings.clear(); savedSettings.forEach((value,key)=>viewSettings.set(key,value));
            setActive(!wasHidden);
        }
    }
    find('fit').onclick = () => fit();
    find('reset').onclick = () => fit(undefined, true);
    find('isometric').onclick = () => fit(selected || model?.rootId, true);
    find('projection').onchange = event => {
        projection = event.target.value;
        if (renderer) { setCamera(); fit(selected || model?.rootId); }
    };
    setModel(null);
    return { setModel, setActive, setOptimizationLabels, createPrintPages, getModel: () => model, getPresentationState: () => {
        scene?.updateMatrixWorld(true);
        return { assemblyId: explosionPlan?.assemblyId ?? null, amount: explosionAmount,
            renderStyle: { colors:[...new Set(meshes.map(mesh=>mesh.material.color.getHexString()))], outlinedParts:meshes.filter(mesh=>mesh.children.some(edge=>edge.visible)).length },
            plane:explosionPlan?.plane || null,
            viewPreset: find('view-preset').value, layout: find('layout').value, spread: ['x','y','z'].map(axis => Number(find('spread-' + axis).value)),
            buildQuantity:viewByInstance.get(explosionPlan?.assemblyId)?.count || 1, assemblyInstances:viewByInstance.get(explosionPlan?.assemblyId)?.memberIds || [],
            referenceParent: find('reference').dataset.referenceParent || null, referenceSelection: find('reference').dataset.referenceSelection || null,
            camera: camera ? { position:camera.position.toArray(), target:controls.target.toArray(), up:camera.up.toArray() } : null,
            isolated: !!explosionPlan && find('isolate').checked,
            parts: Array.from(partCatalog.values()),
            customOffsets: Array.from(corrections(), ([id, value]) => [id, value.slice()]),
            offsets: Array.from(presentationOffsets(model, explosionPlan, explosionAmount, corrections())),
            positions: Array.from(presentations, ([id, object]) => [id, object.position.toArray()]),
            worldMatrices: Array.from(objects, ([id, object]) => [id, object.matrixWorld.toArray()]) };
    } };
}
