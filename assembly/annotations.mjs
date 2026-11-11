import { Matrix4, Vector3 } from 'three';

export function formatMeasurement(value, precision = 16) {
    if (!Number.isFinite(value)) return '—';
    if (![8, 16, 32, 64].includes(precision)) throw Error('Unsupported fractional precision');
    const sign = value < 0 ? '−' : '';
    const count = Math.round(Math.abs(value) * precision);
    if (value !== 0 && count === 0) return `${sign}< 1/${precision}″`;
    const whole = Math.floor(count / precision);
    let numerator = count % precision, denominator = precision;
    while (numerator && numerator % 2 === 0) { numerator /= 2; denominator /= 2; }
    return `${sign}${whole || !numerator ? whole : ''}${whole && numerator ? ' ' : ''}${numerator ? `${numerator}/${denominator}` : ''}″`;
}

const transform = rows => new Matrix4().set(...rows.flat());

// Bounds stay in definition/assembly axes. Only basis lengths affect values;
// presentation translation and camera orientation cannot change measurements.
export function dimensionAxes(bounds, matrix) {
    if (!bounds) return [];
    const elements = matrix.elements;
    const lengths = [0, 1, 2].map(axis => ({ axis,
        value: (bounds.max[axis] - bounds.min[axis]) * Math.hypot(elements[axis * 4], elements[axis * 4 + 1], elements[axis * 4 + 2]) }));
    lengths.sort((a, b) => b.value - a.value || a.axis - b.axis);
    return lengths.map((item, index) => {
        const other = [0, 1, 2].filter(axis => axis !== item.axis);
        const edges = [0, 1, 2, 3].map(corner => {
            const start = bounds.min.slice(), end = bounds.min.slice();
            other.forEach((axis, i) => { start[axis] = end[axis] = (corner & (1 << i)) ? bounds.max[axis] : bounds.min[axis]; });
            end[item.axis] = bounds.max[item.axis];
            return [new Vector3(...start).applyMatrix4(matrix), new Vector3(...end).applyMatrix4(matrix)];
        });
        return { ...item, label: ['L', 'W', 'T'][index], edges };
    });
}

// Every geometry-bearing instance gets its own number in hierarchy order.
// This deliberately avoids claiming manufacturing equivalence from names or
// dimensions when geometry/material/allowance metadata may be incomplete.
export function buildPartCatalog(model) {
    const catalog = new Map();
    if (!model) return catalog;
    function walk(id) {
        const node = model.nodes.get(id);
        const bounds = model.definitions.get(node.definitionId)?.bounds;
        if (bounds) {
            const axes = dimensionAxes(bounds, transform(node.worldMatrix));
            catalog.set(id, { instanceId: id, number: `P${String(catalog.size + 1).padStart(2, '0')}`,
                name: node.name, definitionId: node.definitionId, materialId: node.materialId ?? null, quantity: 1, dimensions: axes.map(axis => axis.value) });
        }
        node.children.forEach(walk);
    }
    walk(model.rootId);
    return catalog;
}

// Follow import-time row IDs rather than matching current names or dimensions.
// The optimizer supplies its existing letters; the viewer never generates them.
export function optimizationLetters(instancePartIds, layouts, labels, keyForPart) {
    const bySource = new Map();
    for (const layout of layouts || []) for (const placement of layout.placements || []) {
        const part = placement.p;
        const letter = labels.get(keyForPart(part));
        if (part.sourcePartId && letter) bySource.set(part.sourcePartId, letter);
    }
    return new Map(Array.from(instancePartIds, ([id, partId]) => [id, bySource.get(partId)]).filter(([, letter]) => letter));
}

export function componentLabel(part, mode) {
    if (mode === 'optimization') return part.optimizationLabel || '—';
    if (mode === 'name') return part.name;
    if (mode === 'number') return part.number;
    if (mode === 'both') return `${part.number} · ${part.name}`;
    return '';
}

function assignedPartKey(part) {
    return JSON.stringify([part.optimizationLabel, part.name, part.dimensions.map(value => value.toFixed(5))]);
}

// Input order expresses selection/camera preference. Each group retains fallback
// instances in that order in case the first cannot fit dimension text onscreen.
export function dimensionCandidateGroups(candidates) {
    const groups = new Map();
    for (const candidate of candidates) {
        const part = candidate.part;
        const key = part.optimizationLabel ? assignedPartKey(part)
            : part.definitionId ? JSON.stringify(['geometry', part.definitionId, part.materialId, part.name, part.dimensions.map(value => value.toFixed(5))])
                : JSON.stringify(['instance', part.instanceId]);
        if (!groups.has(key)) groups.set(key, { key, candidates: [] });
        groups.get(key).candidates.push(candidate);
    }
    return Array.from(groups.values());
}

// Group by the optimizer's assignment, component name, and original modeled
// dimensions (the same five-decimal precision used by SKP cut extraction).
// Unassigned geometry remains instance-specific rather than implying equivalence.
export function summarizeParts(parts) {
    const groups = new Map();
    for (const part of parts) {
        const letter = part.optimizationLabel || '';
        const key = letter ? assignedPartKey(part) : JSON.stringify(['unassigned', part.instanceId]);
        let row = groups.get(key);
        if (!row) {
            row = { letter, name: part.name, dimensions: part.dimensions.slice(), quantity: 0, instanceIds: [] };
            groups.set(key, row);
        }
        row.quantity += part.quantity;
        row.instanceIds.push(part.instanceId);
    }
    return Array.from(groups.values()).sort((a, b) => Number(!a.letter) - Number(!b.letter)
        || a.letter.length - b.letter.length || a.letter.localeCompare(b.letter)
        || a.name.localeCompare(b.name) || a.dimensions[0] - b.dimensions[0]
        || a.dimensions[1] - b.dimensions[1] || a.dimensions[2] - b.dimensions[2]);
}

export function rectanglesOverlap(a, b, padding = 3) {
    return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x
        && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
}

// Stable screen-space placement. Unplaceable labels are counted rather than
// stacked on top of each other; the complete visible-parts list remains available.
export function placeLabels(items, width, height, occupied = [], limit = 40) {
    const placements = [], rectangles = occupied.slice();
    for (const item of items) {
        if (placements.length >= limit) break;
        const w = Math.min(item.width, width - 12), h = item.height;
        if (w <= 0 || h > height - 12) continue;
        const { x, y } = item.anchor;
        const candidates = [];
        for (const distance of [12, 34, 58, 86, 120]) {
            candidates.push([x + distance, y - h / 2], [x - distance - w, y - h / 2],
                [x - w / 2, y - distance - h], [x - w / 2, y + distance]);
        }
        for (const [left, top] of candidates) {
            const rect = { x: Math.max(6, Math.min(width - w - 6, left)), y: Math.max(6, Math.min(height - h - 6, top)), width: w, height: h };
            if (rectangles.some(other => rectanglesOverlap(rect, other))) continue;
            placements.push({ ...item, rect });
            rectangles.push(rect);
            break;
        }
    }
    return placements;
}
