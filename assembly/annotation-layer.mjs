import { Vector3 } from 'three';
import { componentLabel } from './annotations.mjs';
import { projectedObstacle, placeExternalCallouts } from './callout-layout.mjs';

const namespace = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes = {}, text) {
    const element = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
}
function visible(object) {
    while (object) { if (!object.visible) return false; object = object.parent; }
    return true;
}
function corners(bounds, matrix) {
    return Array.from({ length: 8 }, (_, corner) => new Vector3(...[0, 1, 2].map(axis => (corner & (1 << axis)) ? bounds.max[axis] : bounds.min[axis])).applyMatrix4(matrix));
}

export function createAnnotationLayer(host, onSummary) {
    const overlay = svgElement('svg', { class: 'assembly-annotations', 'aria-label': 'Component letter callouts' });
    host.append(overlay);
    const textContext = document.createElement('canvas').getContext('2d');
    textContext.font = '11px ui-sans-serif,system-ui,Arial,sans-serif';
    const textWidth = (text,size=11) => { textContext.font = `${size}px ui-sans-serif,system-ui,Arial,sans-serif`; return textContext.measureText(text).width; };
    function update({ model, catalog, meshes, objects, camera, selected, labelMode, leaders, originGuides = [] }) {
        overlay.replaceChildren();
        const width = host.clientWidth, height = host.clientHeight;
        overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
        if (!model || !width || !height) { onSummary({ visibleParts: [], labels: 0, labelTotal: 0 }); return; }
        camera.updateMatrixWorld();
        function project(point) {
            const result = point.clone().project(camera);
            return { x: (result.x + 1) * width / 2, y: (1 - result.y) * height / 2, z: result.z };
        }
        function onScreen(point) { return point.z >= -1 && point.z <= 1 && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height; }
        for (const guide of originGuides) {
            const start=project(new Vector3(...guide.from)),end=project(new Vector3(...guide.to));
            if(start.z < -1 || start.z > 1 || end.z < -1 || end.z > 1 || ![start.x,start.y,end.x,end.y].every(Number.isFinite)) continue;
            if(Math.hypot(start.x-end.x,start.y-end.y)<2) continue;
            const group=svgElement('g',{'data-origin-guide':guide.id,'data-origin-world':JSON.stringify(guide.from),'data-presented-world':JSON.stringify(guide.to),'aria-label':'Dotted guide from assembled position'});
            group.append(svgElement('line',{x1:start.x,y1:start.y,x2:end.x,y2:end.y,stroke:'#64748b','stroke-width':1.25,'stroke-dasharray':'2 5','stroke-opacity':.85}));
            group.append(svgElement('path',{d:`M ${start.x-3} ${start.y} h 6 M ${start.x} ${start.y-3} v 6`,stroke:'#64748b','stroke-width':1.25,'stroke-opacity':.85,fill:'none'}));
            overlay.append(group);
        }
        const visibleParts = meshes.filter(visible).map(mesh => catalog.get(mesh.userData.instanceId)).filter(Boolean);
        const geometry = visibleParts.map(part => {
            const bounds = model.definitions.get(model.nodes.get(part.instanceId).definitionId).bounds;
            return projectedObstacle(corners(bounds,objects.get(part.instanceId).matrixWorld).map(project),width,height);
        }).filter(Boolean);
        overlay.dataset.geometryBounds = JSON.stringify(geometry);
        const candidates = visibleParts.map(part => {
            const object = objects.get(part.instanceId), bounds = model.definitions.get(model.nodes.get(part.instanceId).definitionId).bounds;
            const anchor = project(new Vector3(...bounds.min.map((value, i) => (value + bounds.max[i]) / 2)).applyMatrix4(object.matrixWorld));
            return { part, object, bounds, anchor };
        }).filter(item => onScreen(item.anchor));
        candidates.sort((a, b) => Number(b.part.instanceId === selected) - Number(a.part.instanceId === selected) || a.anchor.z - b.anchor.z || a.part.number.localeCompare(b.part.number));
        const occupied = [];
        const labelItems = labelMode === 'none' ? [] : candidates.map(item => {
            const fullText = componentLabel(item.part, labelMode);
            const maxCharacters = width < 500 ? 26 : 38;
            let text = fullText.length > maxCharacters ? fullText.slice(0, maxCharacters - 1) + '…' : fullText;
            while (text.length > 1 && textWidth(text,12) + 18 > width - 12) text = text.slice(0, -2) + '…';
            const circular = ['optimization','number'].includes(labelMode);
            const diameter = Math.max(36,Math.ceil(textWidth(text,12)+20));
            return { ...item, text, fullText, circular, width: circular ? diameter : textWidth(text,12)+18, height: circular ? diameter : 28 };
        });
        const placements = placeExternalCallouts(labelItems, width, height, geometry, occupied, width < 500 ? 16 : 48);
        for (const item of placements) {
            const { rect, anchor, part } = item;
            const node = svgElement('g', { 'data-label-instance': part.instanceId, 'data-callout-box': JSON.stringify(rect) });
            node.append(svgElement('title', {}, item.fullText));
            if (leaders) {
                const center = {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
                const distance = Math.hypot(center.x-anchor.x,center.y-anchor.y)||1;
                const end = item.circular ? {x:center.x-(center.x-anchor.x)/distance*rect.width/2,y:center.y-(center.y-anchor.y)/distance*rect.height/2}
                    : { x: Math.max(rect.x, Math.min(rect.x + rect.width, anchor.x)), y: Math.max(rect.y, Math.min(rect.y + rect.height, anchor.y)) };
                node.append(svgElement('line', { x1: anchor.x, y1: anchor.y, x2: end.x, y2: end.y, stroke: '#475569', 'stroke-width': 1 }));
                node.append(svgElement('circle', { cx: anchor.x, cy: anchor.y, r: 2, fill: '#475569' }));
            }
            if (item.circular) node.append(svgElement('circle', { 'data-callout-circle':'true', cx:rect.x+rect.width/2, cy:rect.y+rect.height/2, r:rect.width/2, fill:part.instanceId === selected ? '#fff0cf' : '#ffffff', stroke:'#65594b', 'stroke-width':1.5 }));
            else node.append(svgElement('rect', { ...rect, rx: 5, fill: part.instanceId === selected ? '#fff0cf' : '#ffffff', stroke: '#65594b' }));
            node.append(svgElement('text', { x: rect.x+rect.width/2, y: rect.y+rect.height/2, 'text-anchor':'middle', 'dominant-baseline':'central', 'font-size':12, fill: '#1e293b' }, item.text));
            overlay.append(node);
        }
        onSummary({ visibleParts, labels: placements.length, labelTotal: labelMode === 'none' ? 0 : visibleParts.length });
    }
    return { update, clear() { overlay.replaceChildren(); }, overlay };
}
