const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/../cut-planner.html`, 'utf8');
// Exercise the real SVG renderer without requiring a browser or model imports.
const renderer = html.slice(html.indexOf('function partAnnotations('), html.indexOf("return svg+'</svg>'}") + "return svg+'</svg>'}".length);
for (const scale of ['compact', 'standard', 'large']) {
    for (const printMode of [false, true]) {
        const context = { window: { innerWidth: 1200, innerHeight: 800 }, $: () => ({ value: scale }), printMode };
        vm.createContext(context);
        vm.runInContext(renderer, context);
        for (const kind of ['sheet', 'lumber']) {
            const layout = { kind, m: { width: 48, length: 96 }, placements: [], cuts: [
                { axis: 'v', at: 20, from: 0, to: 40 },
                { axis: 'v', at: 20.2, from: 0, to: 30 },
                { axis: 'v', at: 35, from: 0, to: 40 }
            ] };
            const svg = context.svgLayout(layout, 0);
            const bubbles = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)]
                .map(m => ({ x: +m[1], y: +m[2], radius: +m[3] }));
            assert.equal(bubbles.length, 3);
            const axis = kind === 'sheet' ? 'y' : 'x';
            assert.ok(bubbles[1][axis] > bubbles[0][axis] + 20, 'colliding start moves to end');
            assert.equal(bubbles[2][axis], bubbles[0][axis], 'clear start remains anchored');
            for (let i = 0; i < bubbles.length; i++) {
                for (let j = 0; j < i; j++) {
                    assert.ok(Math.hypot(bubbles[i].x - bubbles[j].x, bubbles[i].y - bubbles[j].y)
                        >= bubbles[i].radius + bubbles[j].radius + 1);
                }
            }
        }
        Object.assign(context, {
            partKey: () => 'part', partLabelForKey: () => 'F', partColorFor: () => '#ffeecc',
            fmtLayout: String, unitMark: () => '"', esc: String
        });
        for (const gap of [.125, 4]) {
            const diagram = context.svgLayout({kind:'sheet',m:{width:48,length:96},kerf:.125,
                placements:[
                    {x:0,y:0,w:5.75,h:10,p:{name:'Upper'}},
                    {x:0,y:10+gap,w:5.75,h:10,p:{name:'Lower'}}
                ],cuts:[{axis:'h',at:10,from:0,to:5.75}]},0);
            const cutY = +diagram.match(/<line [^>]*y1="([^"]+)"/)[1];
            const scaleFactor = {compact:.67,standard:.82,large:.98}[scale];
            const expected = 10 + (gap === .125 ? 10.0625 : 10)*7.4*scaleFactor;
            assert.ok(Math.abs(cutY-expected)<1e-8, 'only kerf gaps may shift a cut line');
        }
        const narrowBoard = context.svgLayout({kind:'lumber',m:{width:2.5,length:96},
            placements:[{x:0,y:0,w:32,h:2.5,p:{name:'Top Support'}}],cuts:[]},0);
        const boardWidth = +narrowBoard.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)"/)[1];
        const base = Math.min(5.2,430/96,150/2.5) * ({compact:.67,standard:.82,large:.98}[scale]);
        assert.ok(boardWidth <= 2.5*base*2 + 1e-8, 'lumber width exaggeration is capped at twice its true scale');
        assert.ok(boardWidth >= 2.5*base*1.7, 'lumber retains modest width enhancement');
        const boardNameFont = +narrowBoard.match(/class="part-name"[^>]*font-size="([^"]+)"/)[1];
        assert.ok(boardNameFont >= 6, 'long narrow board names use the available width');
        const shortBoard = context.partAnnotations(0,0,18,55,2.5,14.625,'Door Rail','AK',true);
        assert.ok(+shortBoard.match(/class="part-name"[^>]*font-size="([^"]+)"/)[1] >= 5,
            'short lumber reserves its interior for the name');
        assert.ok(+shortBoard.match(/class="part-length-dimension" x="([^"]+)"/)[1] > 18,
            'short lumber dimensions use the side gutter');
        assert.match(shortBoard,/class="part-id-bubble"[^>]*r="4.2"/);
        for (const [partWidth, partHeight] of [[4, 32], [32, 4]]) {
            const diagram = context.svgLayout({ kind: 'sheet', m: { width: 48, length: 96 },
                placements: [{ x: 0, y: 0, w: partWidth, h: partHeight,
                    p: { name: 'Top Support' } }], cuts: [] }, 0);
            const widthLabel = diagram.match(/<text class="part-width-dimension" x="([^"]+)" y="([^"]+)"[^>]*>4"<\/text>/);
            assert.ok(widthLabel, 'narrow width has a dedicated inside label');
            const footprint = diagram.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx=/);
            const [, left, top, width, height] = footprint.map(Number);
            const labelX = +widthLabel[1], labelY = +widthLabel[2];
            assert.ok(labelX > left && labelX < left + width);
            assert.ok(labelY > top && labelY < top + height);
            assert.equal((diagram.match(/>4"<\/text>/g) || []).length, 1, 'no duplicate outside width');
        }
        for (const [width, height] of [[180, 450], [450, 180]]) {
            const large = context.partAnnotations(0, 0, width, height, 23.5, 70.5, 'Countertop (short)', 'AI', false);
            const name = large.match(/class="part-name" x="([^"]+)" y="([^"]+)"/);
            assert.equal(+name[1], width/2, 'large part name centered horizontally');
            assert.equal(+name[2], height/2, 'large part name centered vertically');
            const length = large.match(/class="part-length-dimension" x="([^"]+)" y="([^"]+)"/);
            const across = large.match(/class="part-width-dimension" x="([^"]+)" y="([^"]+)"/);
            assert.ok(+(width > height ? length[2] : length[1]) < 16, 'length stays near edge');
            assert.ok(+(width > height ? across[1] : across[2]) > (width > height ? width : 0) - 16);
            if (height > width) assert.ok(+across[2] < 16, 'width stays near top edge');
        }
        for (const [width, height] of [[25, 400], [400, 25]]) {
            const longPart = context.partAnnotations(0, 0, width, height, 3.5, 80, 'Base Toe Kick (large)', 'AC', false);
            assert.match(longPart, /class="part-name"[^>]*font-size="8.2"/, 'long narrow names use full size');
            assert.equal(+longPart.match(/class="part-length-dimension"[^>]*font-size="([^"]+)"/)[1], 8,
                'long narrow dimensions remain readable alongside full-size names');
        }
        const shortPart = context.partAnnotations(0, 0, 70, 16, 22, 3.5, 'Cab Stringer (small)', 'E', false);
        assert.ok(+shortPart.match(/class="part-name"[^>]*font-size="([^"]+)"/)[1] < 8.2,
            'short names still scale down when space is limited');
        // Check annotation bounds and separation for small parts, long names and multi-letter IDs.
        for (const [width, height] of [[200, 18], [18, 200], [70, 16], [16, 70], [12, 12], [4, 20]]) {
            const annotations = context.partAnnotations(0, 0, width, height, width, height,
                'Counter Stile (small)', 'AF', false);
            const boxes = [...annotations.matchAll(/<text class="([^"]+)" x="([^"]+)" y="([^"]+)" font-size="([^"]+)"([^>]*)>([^<]*)<\/text>/g)]
                .map(([, css, x, y, font, attrs, value]) => {
                    x = +x; y = +y; font = +font;
                    let w = value.length * font * .68, h = font * 1.2;
                    if (attrs.includes('rotate(-90')) [w, h] = [h, w];
                    if (css === 'part-length-dimension') assert.equal(attrs.includes('rotate(-90'), height > width);
                    if (css === 'part-width-dimension') assert.equal(attrs.includes('rotate(-90'), width >= height);
                    return { x: x-w/2, y: y-h/2, w, h, css };
                });
            const bubble = annotations.match(/class="part-id-bubble" cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/);
            const radius = +bubble[3];
            assert.equal(radius, 5.4, 'part ID size stays fixed');
            const nameBox = boxes.find(box => box.css === 'part-name');
            const nameEnd = width >= height ? nameBox.x + nameBox.w : nameBox.y;
            const bubbleNear = width >= height ? +bubble[1]-radius : +bubble[2]+radius;
            const anchorGap = width >= height ? bubbleNear-nameEnd : nameEnd-bubbleNear;
            assert.ok(anchorGap >= -1e-8 && anchorGap <= 4.01, 'ID bubble follows name end');
            boxes.push({ x: +bubble[1]-radius, y: +bubble[2]-radius, w: 2*radius, h: 2*radius, css: 'bubble' });
            if (Math.min(width, height) < 16) continue; // Fixed-size IDs can exceed microscopic footprints.
            for (const box of boxes) {
                assert.ok(box.x >= 0 && box.y >= 0 && box.x+box.w <= width && box.y+box.h <= height, box.css + ' fits');
                for (const other of boxes) {
                    if (box === other || box.css === 'part-id' || other.css === 'part-id') continue;
                    assert.ok(box.x+box.w <= other.x || other.x+other.w <= box.x ||
                        box.y+box.h <= other.y || other.y+other.h <= box.y, box.css + ' clear of ' + other.css);
                }
            }
        }
        // The original from/to order determines the start, even for reversed cuts.
        const reversed = context.svgLayout({ kind: 'sheet', m: { width: 48, length: 96 }, placements: [],
            cuts: [{ axis: 'h', at: 20, from: 40, to: 0 }] }, 0);
        const x = +reversed.match(/<circle cx="([^"]+)"/)[1];
        assert.ok(x > 100, 'reversed cut starts on the right');
    }
}
console.log('Cut bubble anchoring passed for sheets, lumber, all scales, and print mode.');
