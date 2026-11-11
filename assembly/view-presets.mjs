import { Matrix4, Vector3 } from 'three';
import { subtreeBounds } from './explosion.mjs';

// Placement-independent identity: shared definition/child structure, inherited
// materials, scale/shear and handedness. Translation and rigid rotation do not
// change a build; same names or similar bounding boxes never establish identity.
export function assemblyViews(model) {
    if (!model) return [];
    const rounded = value => Math.abs(value) < 1e-8 ? 0 : Number(value.toFixed(6));
    const inheritedMaterial = id => {
        let node = model.nodes.get(id);
        while (node) { if (node.materialId != null) return node.materialId; node = model.nodes.get(node.parentId); }
        return null;
    };
    const structureCache = new Map();
    function structure(id) {
        if (structureCache.has(id)) return structureCache.get(id);
        const node = model.nodes.get(id);
        const result = [node.definitionId,inheritedMaterial(id),node.children.map(childId=>{
            const child=model.nodes.get(childId);
            return [child.name,child.localMatrix.flat().map(rounded),structure(childId)];
        })];
        structureCache.set(id,result);return result;
    }
    const grouped = new Map();
    for (const node of model.nodes.values()) {
        if (node.id === model.rootId || !node.children.length) continue;
        const matrix = new Matrix4().set(...node.worldMatrix.flat());
        const basis = [0,1,2].map(axis=>new Vector3(node.worldMatrix[0][axis],node.worldMatrix[1][axis],node.worldMatrix[2][axis]));
        const gram = basis.flatMap(a=>basis.map(b=>rounded(a.dot(b))));
        const key = JSON.stringify([structure(node.id),gram,Math.sign(matrix.determinant())]);
        if (!grouped.has(key)) grouped.set(key,{id:node.id,label:node.name,memberIds:[],level:node.parentId === model.rootId ? 0 : 1,key});
        grouped.get(key).memberIds.push(node.id);
    }
    const names = new Map();
    const views = Array.from(grouped.values()).map(view=>{
        const count = (names.get(view.label)||0)+1;names.set(view.label,count);
        return {...view,count:view.memberIds.length,label:`${view.label}${count>1 ? ` · variant ${count}` : ''} · Build ×${view.memberIds.length}`};
    });
    // Build child assemblies before any parent that uses them. Resolve the
    // dependencies across every instance, including repeated assembly groups.
    const byInstance = new Map(views.flatMap(view=>view.memberIds.map(id=>[id,view])));
    const buildLevels = new Map();
    function buildLevel(view) {
        if (buildLevels.has(view.id)) return buildLevels.get(view.id);
        let level = 0;
        for (const id of view.memberIds) for (const childId of model.nodes.get(id).children) {
            const child = byInstance.get(childId);
            if (child && child !== view) level = Math.max(level,buildLevel(child)+1);
        }
        buildLevels.set(view.id,level);
        return level;
    }
    views.sort((a,b)=>buildLevel(a)-buildLevel(b));
    return [{id:model.rootId,label:'Overview',memberIds:[model.rootId],count:1,level:0},...views];
}

export function referenceContext(model, ids) {
    if (!ids.length) return model.rootId;
    const ancestors = id => {
        const result=[];let node=model.nodes.get(id);
        while(node?.parentId) { result.push(node.parentId);node=model.nodes.get(node.parentId); }
        return result;
    };
    const rest=ids.slice(1).map(id=>new Set(ancestors(id)));
    return ancestors(ids[0]).find(id=>rest.every(set=>set.has(id))) || model.rootId;
}

// Detect a broad, shallow component/subassembly across the assembly's front.
// Geometry, not part names, decides whether a rear view better exposes the box.
export function hasFrontObstruction(model, id) {
    const node = model.nodes.get(id);
    if (!node?.children.length) return false;
    const bounds = subtreeBounds(model, id);
    if (bounds.isEmpty()) return false;
    const size = bounds.getSize(new Vector3());
    let frontArea = 0;
    const frontBounds = [];
    const direct = node.children.some(childId => {
        const child = model.nodes.get(childId);
        const box = subtreeBounds(model, childId, new Matrix4().set(...child.localMatrix.flat()));
        if (box.isEmpty()) return false;
        const span = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
        const nearFront = span.y <= size.y * .35 && center.y <= bounds.min.y + size.y * .25;
        if (nearFront && span.z >= size.z * .5) { frontArea += span.x * span.z; frontBounds.push(box); }
        return span.x >= size.x * .55 && span.z >= size.z * .55
            && span.y <= size.y * .35 && center.y <= bounds.min.y + size.y * .25;
    });
    // Paired doors can cover the front collectively without either spanning it alone.
    return direct || (frontBounds.length > 1 && frontArea >= size.x * size.z * .4);
}
export function presetDirection(model, id, preset = 'auto') {
    const rear = preset === 'auto' ? hasFrontObstruction(model, id) : preset.startsWith('rear');
    const vectors = { front: [0,-1,0], rear: [0,1,0], top: [0,-.001,1] };
    const direction = new Vector3(...(vectors[preset] || [1, rear ? 1 : -1, 1]));
    const node = model.nodes.get(id);
    if (node) direction.transformDirection(new Matrix4().set(...node.worldMatrix.flat()));
    return { direction: direction.normalize(), rear, name: preset === 'auto' ? (rear ? 'Rear isometric · front obstruction detected' : 'Front isometric') : preset };
}

export function partShade(part) {
    // Optimizer letters identify matching manufactured parts. Before optimization,
    // use shared geometry, material, and modeled size instead of instance paths.
    const key = typeof part === 'string' ? part : part.optimizationLabel
        ? JSON.stringify(['cut',part.optimizationLabel])
        : part.definitionId ? JSON.stringify(['geometry',part.definitionId,part.materialId ?? null,part.dimensions.map(value=>value.toFixed(5))])
            : part.instanceId;
    let hash = 0;
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const palette = ['#eadbc0','#d5e2d2','#ebd8c5','#f1e6c6','#d5e2ee','#e6d5b7','#e7dfd5','#e1e7cc'];
    return palette[hash % palette.length];
}
