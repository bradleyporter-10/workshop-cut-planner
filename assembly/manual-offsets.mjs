import { Matrix4, Vector3 } from 'three';
import { explosionOffsets } from './explosion.mjs';

function vector(values) {
    if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) throw Error('Enter finite X, Y, and Z corrections.');
    return new Vector3(...values);
}
function linear(rows) {
    const result = new Matrix4().set(...rows.flat());
    result.setPosition(0, 0, 0);
    return result;
}
function invertible(matrix) {
    const e = matrix.elements;
    const lengths = [0, 4, 8].map(i => Math.hypot(e[i], e[i + 1], e[i + 2]));
    const volume = lengths.reduce((a, b) => a * b, 1);
    if (!lengths.every(value => value > 1e-12) || Math.abs(matrix.determinant()) / volume < 1e-10) {
        throw Error('This placement has collapsed or nearly parallel axes; manual movement is unavailable.');
    }
    return matrix;
}
export function isManualTarget(model, assemblyId, instanceId) {
    if (!model?.nodes.has(assemblyId) || instanceId === assemblyId) return false;
    let node = model.nodes.get(instanceId);
    while (node?.parentId) {
        if (node.parentId === assemblyId) return true;
        node = model.nodes.get(node.parentId);
    }
    return false;
}

// The UI measures physical inches along normalized source axes. Removing basis
// scale prevents a 1-inch jog becoming 2 inches on a scaled assembly. Reflections
// and nonorthogonal (sheared) axes retain their original directions.
function axisFrame(model, assemblyId, instanceId, space) {
    if (!isManualTarget(model, assemblyId, instanceId)) throw Error('Select a part or nested assembly inside the exploded assembly.');
    if (!['assembly', 'local'].includes(space)) throw Error('Unknown movement axes.');
    const id = space === 'assembly' ? assemblyId : instanceId;
    const result = linear(model.nodes.get(id).worldMatrix);
    const e = result.elements;
    for (const start of [0, 4, 8]) {
        const length = Math.hypot(e[start], e[start + 1], e[start + 2]);
        if (length <= 1e-12) throw Error('This placement has a collapsed axis; manual movement is unavailable.');
        for (let index = start; index < start + 3; index++) e[index] /= length;
    }
    return invertible(result);
}
function parentFrame(model, id) {
    const parent = model.nodes.get(model.nodes.get(id).parentId);
    return invertible(linear(parent.worldMatrix));
}
export function correctionToWorld(model, assemblyId, instanceId, space, values) {
    const offset = vector(values).applyMatrix4(axisFrame(model, assemblyId, instanceId, space));
    // Validate the parent conversion before accepting a stored correction.
    parentFrame(model, instanceId);
    return vector(offset.toArray()).toArray();
}
export function correctionInAxes(model, assemblyId, instanceId, space, worldOffset = [0, 0, 0]) {
    parentFrame(model, instanceId);
    return vector(vector(worldOffset).applyMatrix4(axisFrame(model, assemblyId, instanceId, space).invert()).toArray()).toArray();
}

// Canonical corrections are stored outside the model as world-space inch vectors.
// Convert each to its wrapper's parent coordinates, then scale both automatic and
// custom contributions by the explosion percentage. Descendants can be adjusted
// independently while inheriting automatic/manual movement from their ancestors.
export function presentationOffsets(model, plan, percentage, corrections = new Map()) {
    const result = explosionOffsets(plan, percentage);
    if (!plan) return result;
    const fraction = Math.max(0, Math.min(100, Number(percentage))) / 100;
    for (const [id, offset] of corrections) {
        if (!isManualTarget(model, plan.assemblyId, id)) throw Error('Correction lies outside the exploded assembly.');
        const world = vector(offset);
        if (fraction === 0) { result.set(id, [0, 0, 0]); continue; }
        const local = world.applyMatrix4(parentFrame(model, id).invert()).multiplyScalar(fraction);
        const automatic = result.get(id) || [0, 0, 0];
        result.set(id, vector(local.toArray().map((value, i) => value + automatic[i])).toArray());
    }
    return result;
}
