import { Box3, Vector3, MathUtils } from 'three';

// Fit actual projected part-bound corners, rather than a world bounding sphere.
// The limiting screen axis fills the available pixels after reserving callouts.
export function fitCameraToPoints(camera, points, width, height, padding = 10) {
    if (!points.length || width <= 0 || height <= 0) return null;
    const pad = Math.min(padding, Math.min(width, height) * .3);
    const usableX = Math.max(.1, 1 - 2 * pad / width), usableY = Math.max(.1, 1 - 2 * pad / height);
    const aspect = width / height;
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    const right = new Vector3(e[0],e[1],e[2]), up = new Vector3(e[4],e[5],e[6]), back = new Vector3(e[8],e[9],e[10]);
    const origin = new Box3().setFromPoints(points).getCenter(new Vector3());
    const projected = points.map(point => { const p=point.clone().sub(origin);return new Vector3(p.dot(right),p.dot(up),p.dot(back)); });
    const box = new Box3().setFromPoints(projected), middle = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
    const center = origin.clone().addScaledVector(right,middle.x).addScaledVector(up,middle.y).addScaledVector(back,middle.z);
    const local = projected.map(point=>point.sub(middle));
    let distance;
    camera.zoom = 1;
    if (camera.isOrthographicCamera) {
        const span = Math.max(size.y / usableY, size.x / (aspect * usableX), .01) * 1.01;
        camera.userData.span = span;
        camera.left = -span*aspect/2; camera.right = span*aspect/2;
        camera.top = span/2; camera.bottom = -span/2;
        distance = Math.max(size.length(),1)*2;
    } else {
        camera.aspect = aspect;
        const vertical = Math.tan(MathUtils.degToRad(camera.fov/2)), horizontal = vertical*aspect;
        distance = Math.max(.1,...local.map(point=>point.z+Math.max(Math.abs(point.x)/(horizontal*usableX),Math.abs(point.y)/(vertical*usableY)))) * 1.01;
    }
    camera.position.copy(center).addScaledVector(back,distance);
    camera.lookAt(center);
    camera.near = Math.max(.0001,Math.max(size.length(),1)/10000);
    camera.far = Math.max(100,distance+size.length()*4);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return { center, padding:pad, width, height };
}
