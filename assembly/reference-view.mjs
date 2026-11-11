import * as THREE from 'three';
import { subtreeBounds } from './explosion.mjs';
import { fitCameraToPoints } from './camera-fit.mjs';
import { referenceContext } from './view-presets.mjs';

export function createReferenceView(host, caption, title) {
    let renderer, scene, camera, lastModel, parentId, lastGeometries, frameCorners = [];
    const materials = [], items = [];
    function clear() {
        materials.forEach(material => material.dispose()); materials.length = 0; items.length = 0;
        scene = null; lastModel = null; lastGeometries = null; frameCorners = [];
    }
    function update({ model, geometries, edges, activeId, activeIds = [activeId] }) {
        if (!model || !geometries.size || !host.clientWidth || !host.clientHeight) return;
        if (!renderer) {
            try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
            catch { host.textContent = 'Front reference requires WebGL.'; return; }
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.domElement.setAttribute('aria-label', 'Assembled parent, front view with current subassembly highlighted');
            host.replaceChildren(renderer.domElement);
        }
        const scope = model.nodes.get(activeId) || model.nodes.get(model.rootId);
        const parent = referenceContext(model,activeIds);
        const highlights = id => scope.id !== model.rootId && activeIds.some(member=>id === member || id.startsWith(member + '/'));
        if (lastModel !== model || parentId !== parent || lastGeometries !== geometries) {
            clear(); lastModel = model; parentId = parent; lastGeometries = geometries;
            scene = new THREE.Scene(); scene.background = new THREE.Color('#fcfdff');
            scene.add(new THREE.HemisphereLight(0xffffff, 0xa0a0a0, 2.7));
            const light = new THREE.DirectionalLight(0xffffff, 1.5); light.position.set(0,-2,3); scene.add(light);
            camera = new THREE.OrthographicCamera(-1,1,1,-1,.01,100000);
            function add(id) {
                const node = model.nodes.get(id), geometry = geometries.get(node.definitionId);
                if (geometry) {
                    const material = new THREE.MeshStandardMaterial({ color: '#e6e5df', side: THREE.DoubleSide, roughness: .95, flatShading: true, transparent: true, opacity: .12, depthWrite: false });
                    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#a09d94', transparent: true, opacity: .8, depthTest: false });
                    materials.push(material, edgeMaterial);
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.matrixAutoUpdate = false; mesh.matrix.set(...node.worldMatrix.flat());
                    if (edges.has(node.definitionId)) mesh.add(new THREE.LineSegments(edges.get(node.definitionId), edgeMaterial));
                    scene.add(mesh); items.push({ id, material, edgeMaterial });
                }
                node.children.forEach(add);
            }
            add(parent);
        }
        for (const item of items) {
            const highlighted = highlights(item.id);
            item.material.color.set(highlighted ? '#f0cf91' : '#e6e5df');
            item.material.opacity = highlighted ? .88 : .08;
            item.edgeMaterial.opacity = highlighted ? .95 : .65;
            item.edgeMaterial.color.set(highlighted ? '#a55e12' : '#aaa79f');
        }
        const parentNode = model.nodes.get(parent), bounds = subtreeBounds(model, parent);
        if (bounds.isEmpty()) return;
        const transform = new THREE.Matrix4().set(...parentNode.worldMatrix.flat());
        const corners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(...[0,1,2].map(axis => (i & (1 << axis)) ? bounds.max.toArray()[axis] : bounds.min.toArray()[axis])).applyMatrix4(transform));
        const center = bounds.getCenter(new THREE.Vector3()).applyMatrix4(transform);
        const radius = Math.max(1, new THREE.Box3().setFromPoints(corners).getSize(new THREE.Vector3()).length());
        const front = new THREE.Vector3(0,-1,0).transformDirection(transform);
        camera.up.copy(new THREE.Vector3(0,0,1).transformDirection(transform));
        camera.position.copy(center).addScaledVector(front, radius * 2);
        camera.lookAt(center); camera.updateMatrixWorld(true);
        const width = host.clientWidth, height = host.clientHeight;
        fitCameraToPoints(camera,corners,width,height,10);
        renderer.setSize(width,height); renderer.render(scene,camera);
        frameCorners = corners;
        title.textContent = parent === model.rootId ? 'Complete assembly' : parentNode.name;
        caption.textContent = `Front view · ${activeIds.length > 1 ? activeIds.length + ' matching assemblies highlighted' : 'Selected assembly highlighted'}`;
        host.dataset.referenceHighlightCount = String(items.filter(item => highlights(item.id)).length);
        host.dataset.referenceInstances = JSON.stringify(activeIds);
        host.dataset.referenceParent = parent; host.dataset.referenceSelection = scope.id;
    }
    function snapshot() {
        if (!renderer || !scene || !frameCorners.length) return null;
        renderer.render(scene,camera);
        const source = renderer.domElement;
        const points = frameCorners.map(point=>point.clone().project(camera));
        const pad = 10 * source.width / host.clientWidth;
        const left = Math.max(0,Math.floor(Math.min(...points.map(p=>(p.x+1)*source.width/2))-pad));
        const top = Math.max(0,Math.floor(Math.min(...points.map(p=>(1-p.y)*source.height/2))-pad));
        const right = Math.min(source.width,Math.ceil(Math.max(...points.map(p=>(p.x+1)*source.width/2))+pad));
        const bottom = Math.min(source.height,Math.ceil(Math.max(...points.map(p=>(1-p.y)*source.height/2))+pad));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1,right-left); canvas.height = Math.max(1,bottom-top);
        canvas.getContext('2d').drawImage(source,left,top,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
        return canvas.toDataURL('image/png');
    }
    return { update, clear, snapshot };
}
