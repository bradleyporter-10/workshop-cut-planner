import { Box3, Matrix4, Vector3 } from 'three';

const axes = [
    { axis: 0, sign: -1, name: '-x' }, { axis: 0, sign: 1, name: '+x' },
    { axis: 1, sign: -1, name: '-y' }, { axis: 1, sign: 1, name: '+y' },
    { axis: 2, sign: -1, name: '-z' }, { axis: 2, sign: 1, name: '+z' }
];
const matrix = rows => new Matrix4().set(...rows.flat());
const box = bounds => new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
const serialized = bounds => ({ min: bounds.min.toArray(), max: bounds.max.toArray() });

// Bound descendants in the requested node's coordinate system, composing local
// matrices directly. No world inverse or matrix decomposition is needed, even
// for reflected, sheared, nonuniformly scaled, or singular placements.
export function subtreeBounds(model, id, transform = new Matrix4()) {
    const node = model.nodes.get(id);
    const result = new Box3();
    if (!node) return result;
    const bounds = model.definitions.get(node.definitionId)?.bounds;
    if (bounds) result.union(box(bounds).applyMatrix4(transform));
    for (const childId of node.children) {
        const child = model.nodes.get(childId);
        result.union(subtreeBounds(model, childId, transform.clone().multiply(matrix(child.localMatrix))));
    }
    return result;
}

// Find the first distance on a single axis whose padded box clears every
// obstacle. Transverse intersections produce forbidden intervals along the ray;
// merging those intervals avoids iterative collision solvers and unstable jitter.
function clearance(bounds, obstacles, direction, gap, minimum) {
    const { axis, sign } = direction;
    const low = bounds.min.toArray(), high = bounds.max.toArray();
    const intervals = [];
    for (const obstacle of obstacles) {
        const otherLow = obstacle.min.toArray(), otherHigh = obstacle.max.toArray();
        if ([0, 1, 2].some(i => i !== axis && (high[i] + gap <= otherLow[i] || low[i] >= otherHigh[i] + gap))) continue;
        const start = sign > 0 ? otherLow[axis] - high[axis] - gap : low[axis] - otherHigh[axis] - gap;
        const end = sign > 0 ? otherHigh[axis] - low[axis] + gap : high[axis] - otherLow[axis] + gap;
        intervals.push([start, end]);
    }
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let distance = minimum;
    for (const [start, end] of intervals) {
        if (distance < start) break;
        if (distance <= end) distance = end + gap * 1e-6;
    }
    return distance;
}

export function assemblyPlane(children, size) {
    const sorted = [0,1,2].sort((a,b)=>size[a]-size[b]);
    const normal = sorted[0];
    if (size[normal] > Math.max(size[sorted[1]],1e-9) * .25) return null;
    const centers = children.map(child=>child.bounds.getCenter(new Vector3()).toArray()[normal]);
    if (Math.max(...centers)-Math.min(...centers) > Math.max(size[normal]*.6,1e-6)) return null;
    return normal;
}

function planarExplosion(children, assembly, own, spacing, spread, layout, normal) {
    const size=assembly.getSize(new Vector3()).toArray(),center=assembly.getCenter(new Vector3()).toArray();
    const inPlane=[0,1,2].filter(axis=>axis!==normal);
    const gap=Math.max(.25,Math.min(...inPlane.map(axis=>size[axis]))*.1)*spacing;
    const epsilon=Math.max(...size,1)*1e-7;
    const entries=children.map((child,index)=>{
        const c=child.bounds.getCenter(new Vector3()).toArray();
        const base=c.map((value,axis)=>axis===normal || Math.abs(value-center[axis])<epsilon ? 0 : (value-center[axis])/Math.max(size[axis]/2,epsilon)*gap*spread[axis]);
        return {...child,index,base,center:c};
    });
    const fixed=own ? [{bounds:box(own),base:[0,0,0],center:box(own).getCenter(new Vector3()).toArray()}] : [];
    const all=[...entries,...fixed];
    let factor=layout==='even' ? 1.5 : 1;
    // A common, axis-normalized expansion preserves mating-line alignment. In
    // particular a center support remains central instead of crossing a long rail.
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++) {
        const a=all[i],b=all[j];
        if(a.bounds.max.toArray()[normal]<b.bounds.min.toArray()[normal]||b.bounds.max.toArray()[normal]<a.bounds.min.toArray()[normal])continue;
        const needed=inPlane.map(axis=>{
            const velocity=a.base[axis]-b.base[axis],delta=a.center[axis]-b.center[axis];
            const half=(a.bounds.getSize(new Vector3()).toArray()[axis]+b.bounds.getSize(new Vector3()).toArray()[axis])/2;
            if(Math.abs(velocity)<epsilon)return Math.abs(delta)>half+gap ? 0 : Infinity;
            return Math.max(0,(half+gap+epsilon-Math.sign(velocity)*delta)/Math.abs(velocity));
        });
        const required=Math.min(...needed);
        if(Number.isFinite(required))factor=Math.max(factor,Math.min(required,4));
    }
    const placed=fixed.map(item=>item.bounds),offsets=new Map(),bounds=new Map();
    entries.sort((a,b)=>Math.hypot(...inPlane.map(axis=>(a.center[axis]-center[axis])/Math.max(size[axis],epsilon)))
        -Math.hypot(...inPlane.map(axis=>(b.center[axis]-center[axis])/Math.max(size[axis],epsilon)))||a.index-b.index);
    for(const entry of entries) {
        const offset=entry.base.map(value=>value*factor),moved=entry.bounds.clone().translate(new Vector3(...offset));
        const obstacles=placed.filter(other=>!(other.max.toArray()[normal]<moved.min.toArray()[normal]||moved.max.toArray()[normal]<other.min.toArray()[normal]));
        const collides=obstacles.some(other=>inPlane.every(axis=>moved.max.toArray()[axis]+gap>other.min.toArray()[axis]&&moved.min.toArray()[axis]<other.max.toArray()[axis]+gap));
        if(collides) {
            // Coincident/overlapping centers cannot be resolved by radial spread.
            // Keep central anchors first; move later pieces by the shortest planar ray.
            const choices=axes.filter(direction=>direction.axis!==normal).map(direction=>({direction,distance:clearance(moved,obstacles,direction,gap,0)}));
            choices.sort((a,b)=>a.distance-b.distance||a.direction.axis-b.direction.axis||a.direction.sign-b.direction.sign);
            const chosen=choices[0];offset[chosen.direction.axis]+=chosen.direction.sign*chosen.distance;
        }
        offset[normal]=0;
        offsets.set(entry.id,offset);bounds.set(entry.id,serialized(entry.bounds));
        placed.push(entry.bounds.clone().translate(new Vector3(...offset)));
    }
    return {offsets,bounds,gap,planeAxis:normal,plane:['YZ','XZ','XY'][normal]};
}

export function planExplosion(model, assemblyId, options = {}) {
    const node = model.nodes.get(assemblyId);
    if (!node?.children.length) throw Error('Select an assembly with child components.');
    if (node.children.length > 1000) throw Error('Select a smaller assembly (up to 1,000 immediate children).');
    const spacing = Number(options.spacing ?? 1);
    if (!Number.isFinite(spacing) || spacing < .5 || spacing > 2) throw Error('Spacing must be between 0.5 and 2.');
    const spread = options.spread || [1, 1, 1];
    if (!Array.isArray(spread) || spread.length !== 3 || !spread.every(value => Number.isFinite(value) && value >= .5 && value <= 2)) throw Error('X/Y/Z spread must be between 0.5 and 2.');
    const layout = options.layout || 'logical';
    if (!['logical', 'even'].includes(layout)) throw Error('Unknown pull-apart layout.');
    const forced = options.direction && options.direction !== 'auto' ? axes.find(axis => axis.name === options.direction) : null;
    if (options.direction && options.direction !== 'auto' && !forced) throw Error('Unknown separation direction.');
    const children = node.children.map(id => ({ id, bounds: subtreeBounds(model, id, matrix(model.nodes.get(id).localMatrix)) }))
        .filter(child => !child.bounds.isEmpty());
    if (!children.length) throw Error('This assembly has no child geometry to separate.');
    const assembly = subtreeBounds(model, assemblyId);
    const size = assembly.getSize(new Vector3()).toArray();
    const center = assembly.getCenter(new Vector3()).toArray();
    const plane = forced ? null : assemblyPlane(children,size);
    if (plane !== null) {
        const planar = planarExplosion(children,assembly,model.definitions.get(node.definitionId)?.bounds,spacing,spread,layout,plane);
        return {assemblyId,spacing,direction:'auto',spread:spread.slice(),layout,...planar,skipped:node.children.length-children.length};
    }
    const gap = Math.max(.25, Math.max(...size) * .08) * spacing;
    const radial = new Map(children.map(child => [child.id, !forced && layout === 'even'
        ? child.bounds.getCenter(new Vector3()).toArray().map((value, axis) => (value - center[axis]) * spacing * spread[axis]) : [0, 0, 0]]));
    const own = model.definitions.get(node.definitionId)?.bounds;
    const placed = own ? [box(own)] : [];
    const offsets = new Map();
    const bounds = new Map();
    // Hierarchy order is stable and repeated definitions remain independent.
    for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const childCenter = child.bounds.getCenter(new Vector3()).toArray();
        const childSize = child.bounds.getSize(new Vector3()).toArray();
        const relative = childCenter.map((v, i) => (v - center[i]) / Math.max(size[i] / 2, 1e-9));
        const initial = radial.get(child.id);
        const shifted = child.bounds.clone().translate(new Vector3(...initial));
        const obstacles = [...placed, ...children.slice(index + 1).map(other => other.bounds.clone().translate(new Vector3(...radial.get(other.id))))];
        const candidates = (forced ? [forced] : axes).map((direction, order) => {
            const { axis, sign } = direction;
            const outward = relative[axis] * sign;
            const thin = childSize[axis] / Math.max(...childSize, 1e-9);
            // Boundary panels prefer their outward normal. Interior panels use
            // the assembly's front (-Y), providing a readable shelf fallback.
            const preference = outward * 2 + (outward > .55 ? (1 - thin) * 1.5 : 0)
                + (axis === 1 && sign === -1 ? .5 : 0)
                + (axis === 1 && sign === -1 && childSize[2] < Math.max(...childSize) * .2 && Math.abs(relative[2]) < .6 ? 1.5 : 0);
            const distance = clearance(shifted, obstacles, direction, gap * spread[axis], (gap + childSize[axis] * .45 * spacing) * spread[axis]);
            const cost = -preference; // Resolve collisions along the logical axis, rather than switching axes to save distance.
            return { direction, distance, cost, order };
        });
        candidates.sort((a, b) => a.cost - b.cost || a.order - b.order);
        const chosen = candidates[0];
        const offset = initial.slice();
        offset[chosen.direction.axis] += chosen.direction.sign * chosen.distance;
        const moved = child.bounds.clone().translate(new Vector3(...offset));
        offsets.set(child.id, offset);
        bounds.set(child.id, serialized(child.bounds));
        placed.push(moved);
    }
    return { assemblyId, spacing, direction: forced?.name || 'auto', spread: spread.slice(), layout, gap, offsets, bounds,
        skipped: node.children.length - children.length };
}

// Only the presentation wrappers receive these offsets. At zero use literal
// zeros to restore assembled transforms exactly, with no interpolation residue.
export function explosionOffsets(plan, percentage) {
    const amount = Number(percentage);
    if (!Number.isFinite(amount)) throw Error('Explosion amount must be finite.');
    // Calibrate 50% to the former 75% separation, retaining linear motion.
    const fraction = Math.max(0, Math.min(100, amount)) / 100 * 1.5;
    return new Map(Array.from(plan?.offsets || [], ([id, offset]) => [id, fraction === 0 ? [0, 0, 0] : offset.map(v => v * fraction)]));
}
