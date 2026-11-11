import { Matrix4, Vector3 } from 'three';
import { subtreeBounds } from './explosion.mjs';

// Only independently moved wrappers receive a guide: nested assemblies get one
// guide as a unit, while a manually corrected descendant gets its own guide.
export function buildOriginGuides(model, offsets, objects) {
    if (!model) return [];
    const guides=[];
    for (const [id,offset] of offsets) {
        if (!offset.some(value=>Math.abs(value)>1e-8)) continue;
        const object=objects.get(id),node=model.nodes.get(id);
        if (!object||!node) continue;
        let ancestor=object,shown=true;
        while(ancestor) { if(!ancestor.visible) {shown=false;break;} ancestor=ancestor.parent; }
        if(!shown) continue;
        const bounds=subtreeBounds(model,id);
        if(bounds.isEmpty()) continue;
        const center=bounds.getCenter(new Vector3());
        const original=new Matrix4().set(...node.worldMatrix.flat());
        const originalCenter=center.clone().applyMatrix4(original),presentedCenter=center.clone().applyMatrix4(object.matrixWorld);
        // Use the trailing face so the dotted segment crosses the opened joint
        // rather than disappearing inside a thick rail's center.
        if(Math.abs(original.determinant())>1e-12) {
            const localDelta=presentedCenter.clone().applyMatrix4(original.clone().invert()).sub(center).toArray();
            const e=original.elements;
            const physical=localDelta.map((v,i)=>Math.abs(v)*Math.hypot(e[i*4],e[i*4+1],e[i*4+2]));
            const axis=physical.indexOf(Math.max(...physical));
            if(physical[axis]>1e-8)center.setComponent(axis,localDelta[axis]>0 ? bounds.min.getComponent(axis) : bounds.max.getComponent(axis));
        }
        const from=center.clone().applyMatrix4(original);
        const to=center.clone().applyMatrix4(object.matrixWorld);
        if(from.distanceToSquared(to)>1e-12) guides.push({id,from:from.toArray(),to:to.toArray()});
    }
    return guides;
}
