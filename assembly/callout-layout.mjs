import { rectanglesOverlap } from './annotations.mjs';

// Conservative projected part boxes keep annotation bodies clear of every part,
// including parts whose center is offscreen. Near-plane intersections reserve
// the viewport rather than guessing a safe text position through the camera.
export function projectedObstacle(points, width, height, padding = 8) {
    if (!points.length || points.some(p => ![p.x,p.y,p.z].every(Number.isFinite))) return null;
    if (points.every(p => p.z < -1) || points.every(p => p.z > 1)) return null;
    if (points.some(p => p.z < -1)) return { x:0, y:0, width, height };
    const left = Math.max(0,Math.min(...points.map(p=>p.x))-padding);
    const right = Math.min(width,Math.max(...points.map(p=>p.x))+padding);
    const top = Math.max(0,Math.min(...points.map(p=>p.y))-padding);
    const bottom = Math.min(height,Math.max(...points.map(p=>p.y))+padding);
    return right > left && bottom > top ? {x:left,y:top,width:right-left,height:bottom-top} : null;
}
export function clearCallout(rect, width, height, geometry, occupied = []) {
    return rect.x >= 5 && rect.y >= 5 && rect.x+rect.width <= width-5 && rect.y+rect.height <= height-5
        && !geometry.some(other=>rectanglesOverlap(rect,other,3))
        && !occupied.some(other=>rectanglesOverlap(rect,other,5));
}
export function clearDimensionLine(a,b,geometry) {
    // Slab intersection against padded screen boxes. Extension/leader lines
    // necessarily touch their part; the measurement line itself stays outside.
    return !geometry.some(rect=>{
        let low=0,high=1;
        for(const [axis,start,size] of [['x',rect.x,rect.width],['y',rect.y,rect.height]]) {
            const delta=b[axis]-a[axis];
            if(Math.abs(delta)<1e-10) { if(a[axis]<start-2||a[axis]>start+size+2)return false; }
            else {
                const first=(start-2-a[axis])/delta,last=(start+size+2-a[axis])/delta;
                low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));
                if(low>high)return false;
            }
        }
        return low<=high;
    });
}
export function placeExternalCallouts(items,width,height,geometry,occupied=[],limit=40) {
    const placed=[],reserved=occupied.slice();
    for(const item of items) {
        if(placed.length>=limit)break;
        const w=item.width,h=item.height,{x,y}=item.anchor;
        const choices=[];
        for(let distance=28;distance<=Math.max(width,height)+40;distance+=28) {
            choices.push([x+distance,y-h/2],[x-distance-w,y-h/2],[x-w/2,y+distance],[x-w/2,y-distance-h]);
        }
        // Perimeter rails provide additional room when many parts share a center.
        for(let offset=8;offset<height-h-5;offset+=h+8)choices.push([8,offset],[width-w-8,offset]);
        for(let offset=8;offset<width-w-5;offset+=w+8)choices.push([offset,8],[offset,height-h-8]);
        const feasible=choices.map(([left,top])=>({x:left,y:top,width:w,height:h}))
            .filter(rect=>clearCallout(rect,width,height,geometry,reserved));
        feasible.sort((a,b)=>Math.hypot(a.x+w/2-x,a.y+h/2-y)-Math.hypot(b.x+w/2-x,b.y+h/2-y));
        if(!feasible.length)continue;
        const rect=feasible[0];placed.push({...item,rect});reserved.push(rect);
    }
    return placed;
}
