import { ShapeUtils, Vector2, Vector3 } from 'three';

// OpenSKP coordinates and translations are inches, regardless of model display units.
// Reuse the planner's tested parser adapters; retain matrices rather than decomposing
// them so reflections, nonuniform scale, and nested rotations survive unchanged.
export function normalizeAssembly(model, adapters, options = {}) {
    const { getDefs, getVertices, getInstances, defRef, getHiddenLayerSet,
        normalizeMatrix, mm, basisNorm, isSheared } = adapters;
    const definitions = new Map();
    const nodes = new Map();
    const issues = [];
    const sourceDefs = getDefs(model);
    const hiddenLayers = getHiddenLayerSet(model);
    const identity = normalizeMatrix(null);
    function definition(source, id) {
        if (definitions.has(id)) return definitions.get(id);
        const points = getVertices(source).map(v => ({ id: v.id, point: [v.x ?? v[0], v.y ?? v[1], v.z ?? v[2]].map(Number) }));
        const valid = points.filter(v => v.point.every(Number.isFinite));
        if (valid.length !== points.length) issues.push(`${id}: invalid vertices omitted`);
        const bounds = valid.length ? {
            min: [0, 1, 2].map(i => valid.reduce((n, v) => Math.min(n, v.point[i]), Infinity)),
            max: [0, 1, 2].map(i => valid.reduce((n, v) => Math.max(n, v.point[i]), -Infinity))
        } : null;
        const geometry = triangulateDefinition(source, new Map(valid.map(v => [v.id, v.point])), issues, id);
        const value = { id, name: source.name || 'Model', bounds, geometry,
            representation: geometry.length ? 'mesh' : bounds ? 'bounding-box' : 'empty' };
        definitions.set(id, value);
        return value;
    }
    function visit(source, parentId, index, parentWorld, active, depth) {
        const id = `${parentId}/${index}`;
        const ref = defRef(source);
        const raw = sourceDefs.get(ref);
        if (!raw || active.has(ref) || depth > 128 || nodes.size >= 20000) {
            issues.push(`${id}: missing definition, cycle, or hierarchy limit`);
            return null;
        }
        const hidden = !!source.hidden || hiddenLayers.has(String(source.layer || '').trim());
        if (hidden && !options.includeHidden) return null;
        let localMatrix;
        try {
            localMatrix = normalizeMatrix(source.matrix);
            if (!localMatrix.flat().every(Number.isFinite) || localMatrix[3].some((v, i) => Math.abs(v - identity[3][i]) > 1e-8)) throw Error('Invalid affine matrix');
        } catch (error) {
            issues.push(`${id}: ${error.message}`);
            return null;
        }
        const worldMatrix = mm(parentWorld, localMatrix);
        const def = definition(raw, String(ref));
        const spans = def.bounds ? def.bounds.max.map((v, i) => (v - def.bounds.min[i]) * basisNorm(worldMatrix, i)) : null;
        const sorted = spans?.slice().sort((a, b) => b - a);
        const node = { id, parentId, definitionId: def.id, name: String(source.name || raw.name || `Unnamed #${ref}`),
            localMatrix, worldMatrix, hidden, layer: source.layer || '', materialId: source.materialId ?? null,
            dimensions: sorted ? { length: sorted[0], width: sorted[1], thickness: sorted[2] } : null,
            sheared: isSheared(worldMatrix), children: [] };
        nodes.set(id, node);
        if (node.sheared) issues.push(`${id}: sheared placement; dimensions describe scaled local axes`);
        const next = new Set([...active, ref]);
        getInstances(raw).forEach((child, i) => {
            const result = visit(child, id, i, worldMatrix, next, depth + 1);
            if (result) node.children.push(result.id);
        });
        return node;
    }
    const rootDef = definition(model.root ?? model, 'root');
    const root = { id: 'model', parentId: null, definitionId: rootDef.id, name: options.name || 'SketchUp model',
        localMatrix: identity, worldMatrix: identity, children: [], dimensions: null };
    nodes.set(root.id, root);
    getInstances(model.root ?? model).forEach((child, i) => {
        const result = visit(child, root.id, i, identity, new Set(), 0);
        if (result) root.children.push(result.id);
    });
    return { units: 'in', sourceDisplayUnits: model.units, rootId: root.id, definitions, nodes, issues };
}

export function triangulateDefinition(source, vertices, issues, id) {
    const edges = new Map((source.edges || []).map(edge => [edge.id, edge]));
    const positions = [];
    for (const face of source.faces || []) {
        try {
            const loops = face.loops.map(loop => {
                const points = loop.map(use => {
                    const edge = edges.get(use.edgeId);
                    const point = vertices.get(use.orientation === 1 ? edge?.v1Id : edge?.v2Id);
                    if (!point) throw Error('Missing face edge or vertex');
                    return point;
                });
                if (points.length > 1 && points[0].every((v, i) => v === points.at(-1)[i])) points.pop();
                if (points.length < 3) throw Error('Incomplete face loop');
                return points;
            });
            if (!loops.length) throw Error('Empty face');
            const a = new Vector3(...loops[0][0]);
            let normal = new Vector3();
            for (let i = 1; i < loops[0].length - 1 && normal.lengthSq() < 1e-20; i++) {
                normal.crossVectors(new Vector3(...loops[0][i]).sub(a), new Vector3(...loops[0][i + 1]).sub(a));
            }
            if (normal.lengthSq() < 1e-20) throw Error('Degenerate face');
            const components = normal.toArray().map(Math.abs);
            const drop = components.indexOf(Math.max(...components));
            const axes = [0, 1, 2].filter(i => i !== drop);
            const projected = loops.map(loop => loop.map(p => new Vector2(p[axes[0]], p[axes[1]])));
            const triangles = ShapeUtils.triangulateShape(projected[0], projected.slice(1));
            if (!triangles.length) throw Error('Face could not be triangulated');
            const flat = loops.flat();
            for (const triangle of triangles) for (const index of triangle) positions.push(...flat[index]);
        } catch (error) {
            issues.push(`${id} face ${face.id}: ${error.message}`);
        }
    }
    return positions;
}
