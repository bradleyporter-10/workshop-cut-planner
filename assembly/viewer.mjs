import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export { normalizeAssembly } from './model.mjs';

export function createViewer(section) {
    const find = role => section.querySelector(`[data-assembly="${role}"]`);
    const host = find('viewport');
    const tree = find('tree');
    const status = find('status');
    const info = find('info');
    let model = null, scene, renderer, camera, controls, content, selected = null;
    let projection = 'perspective';
    const objects = new Map(), meshes = [], resources = new Set();
    const buttons = new Map();
    const raycaster = new THREE.Raycaster();
    let pointerStart;
    function draw() {
        if (renderer && section.open) renderer.render(scene, camera);
    }
    function resize() {
        if (!renderer || !section.open) return;
        const width = Math.max(1, host.clientWidth), height = host.clientHeight;
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
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#f1f5f9');
        scene.add(new THREE.HemisphereLight(0xffffff, 0x786951, 2.6));
        const light = new THREE.DirectionalLight(0xffffff, 2.2);
        light.position.set(1, -2, 3);
        scene.add(light);
        setCamera();
        host.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
        host.addEventListener('pointerup', event => {
            if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
            const rect = host.getBoundingClientRect();
            raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
            const hit = raycaster.intersectObjects(meshes).find(hit => {
                let object = hit.object;
                while (object) { if (!object.visible) return false; object = object.parent; }
                return true;
            });
            if (hit) select(hit.object.userData.instanceId);
        });
        new ResizeObserver(resize).observe(host);
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
    function fit(id = model?.rootId, isometric = false) {
        const object = objects.get(id);
        if (!object || !renderer) return;
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, .5);
        const direction = isometric ? new THREE.Vector3(1, -1, 1).normalize() : camera.position.clone().sub(controls.target).normalize();
        const aspect = Math.max(.05, host.clientWidth / host.clientHeight);
        const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) * Math.min(1, aspect));
        camera.position.copy(center).addScaledVector(direction, radius / Math.sin(halfFov) * 1.15);
        controls.target.copy(center);
        camera.near = Math.max(.001, radius / 10000);
        camera.far = Math.max(1000, radius * 100);
        camera.userData.span = radius * 2.3 / Math.min(1, aspect);
        if (camera.isOrthographicCamera) {
            camera.zoom = 1;
            camera.top = camera.userData.span / 2;
            camera.bottom = -camera.userData.span / 2;
        }
        controls.update();
        resize();
    }
    function select(id) {
        selected = id;
        const node = model.nodes.get(id);
        const descendants = new Set();
        function collect(key) { descendants.add(key); model.nodes.get(key).children.forEach(collect); }
        collect(id);
        for (const mesh of meshes) mesh.material.emissive.set(descendants.has(mesh.userData.instanceId) ? '#3e2600' : '#000000');
        for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
        const d = node.dimensions;
        info.textContent = `${node.name}${d ? ` · Modeled L × W × T: ${[d.length, d.width, d.thickness].map(v => Number(v.toFixed(4))).join(' × ')} in` : ' · Assembly'}${node.sheared ? ' · Sheared: dimensions follow scaled local axes' : ''}`;
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
            button.type = 'button'; button.textContent = node.name;
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
        if (content) scene.remove(content);
        for (const resource of resources) resource.dispose();
        resources.clear(); objects.clear(); meshes.length = 0;
        content = null;
    }
    function buildScene() {
        if (!renderer || !model) return;
        release();
        const geometries = new Map();
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
            if (geometry) { geometries.set(id, geometry); resources.add(geometry); }
        }
        function branch(id) {
            const node = model.nodes.get(id), group = new THREE.Group();
            group.matrixAutoUpdate = false;
            group.matrix.set(...node.localMatrix.flat());
            objects.set(id, group);
            const geometry = geometries.get(node.definitionId);
            if (geometry) {
                const def = model.definitions.get(node.definitionId);
                const material = new THREE.MeshStandardMaterial({ color: def.representation === 'mesh' ? '#c9aa79' : '#91b7ce', roughness: .85, side: THREE.DoubleSide, wireframe: def.representation !== 'mesh' });
                resources.add(material);
                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.instanceId = id;
                group.add(mesh); meshes.push(mesh);
            }
            node.children.forEach(child => group.add(branch(child)));
            return group;
        }
        content = branch(model.rootId);
        scene.add(content);
        scene.updateMatrixWorld(true);
        fit(model.rootId, true);
    }
    function setModel(next) {
        model = next; selected = null;
        if (renderer) release();
        info.textContent = 'Select a component to inspect its modeled dimensions (inches).';
        status.textContent = model ? `${model.nodes.size - 1} instances · ${model.issues.length} review notes. Neutral surfaces show parsed faces; blue wireframes are approximate bounding boxes. Materials and textures are not reproduced.`
            : 'Import a SketchUp file to view its assembly. CSV, example parts, and saved cut-list projects do not contain 3D geometry.';
        const notes = find('notes');
        notes.replaceChildren();
        if (model?.issues.length) {
            const summary = document.createElement('summary'); summary.textContent = 'Geometry and hierarchy review notes'; notes.append(summary);
            const text = document.createElement('p'); text.textContent = model.issues.slice(0, 100).join('\n'); notes.append(text);
        }
        buildTree();
        if (section.open && model && initialize()) buildScene();
        draw();
    }
    section.addEventListener('toggle', () => {
        if (section.open && model && initialize()) {
            if (!content) buildScene();
            resize();
        }
    });
    find('fit').onclick = () => fit();
    find('reset').onclick = () => fit(model?.rootId, true);
    find('isometric').onclick = () => fit(selected || model?.rootId, true);
    find('projection').onchange = event => {
        projection = event.target.value;
        if (renderer) { setCamera(); fit(selected || model?.rootId); }
    };
    setModel(null);
    return { setModel, getModel: () => model };
}
