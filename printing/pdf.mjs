import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const MARGIN=9, WIDTH=215.9, HEIGHT=279.4, GAP=4;
const CONTENT=WIDTH-2*MARGIN;
// Standard PDF fonts do not include the Unicode inch mark or arrow glyphs.
const text=value=>String(value??'').replace(/[″”]/g,'"').replace(/[‘’]/g,"'").replace(/[–—]/g,'-').replace(/×/g,'x').replace(/→/g,'->');
function tableData(table) {
    if(!table)return null;
    const row=element=>Array.from(element.cells,cell=>{
        const checkbox=cell.querySelector('input[type=checkbox]');
        return checkbox?(checkbox.checked?'[x]':'[ ]'):text(cell.textContent.trim());
    });
    return {head:Array.from(table.tHead?.rows||[],row),body:Array.from(table.tBodies).flatMap(body=>Array.from(body.rows,row))};
}
function tableOptions(data,width,x,y,assembly=false) {
    return {...data,startY:y,tableWidth:width,theme:'grid',rowPageBreak:'avoid',
        margin:{top:14,bottom:MARGIN,left:x,right:MARGIN},
        styles:{font:'helvetica',fontSize:7,cellPadding:1,overflow:'linebreak',textColor:[30,41,59],lineColor:[223,229,236],lineWidth:.15},
        headStyles:{fillColor:[241,245,249],textColor:[71,85,105],fontStyle:'bold'},
        ...(assembly?{columnStyles:{0:{cellWidth:width*.38},1:{cellWidth:width*.1},2:{cellWidth:width*.173333},3:{cellWidth:width*.173333},4:{cellWidth:width*.173334}}}:{})};
}
function measureTable(data,width,assembly=false) {
    if(!data)return 0;
    const measure=new jsPDF({unit:'mm',format:[WIDTH,5000],compress:true});
    const options=tableOptions(data,width,0,0,assembly);
    autoTable(measure,{...options,margin:{top:0,bottom:0,left:0,right:0}});
    return (measure.getNumberOfPages()-1)*5000+measure.lastAutoTable.finalY;
}
async function loadImage(source) {
    const image=new Image();image.src=source;await image.decode();return image;
}
async function drawingImage(element) {
    const svg=element.tagName.toLowerCase()==='svg'?element:null;
    let base,overlay;
    if(svg) {
        const clone=svg.cloneNode(true),box=svg.viewBox.baseVal;
        clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
        clone.setAttribute('width',box.width);clone.setAttribute('height',box.height);
        base=await loadImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(clone)));
    } else {
        const images=element.querySelectorAll('img');
        base=await loadImage(images[0].src);
        if(images[1])overlay=await loadImage(images[1].src);
    }
    // One bounded canvas at a time avoids iPhone canvas/memory limits.
    const scale=Math.min(2,1600/base.naturalWidth,1800/base.naturalHeight);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(base.naturalWidth*scale));
    canvas.height=Math.max(1,Math.ceil(base.naturalHeight*scale));
    const context=canvas.getContext('2d');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(base,0,0,canvas.width,canvas.height);
    if(overlay)context.drawImage(overlay,0,0,canvas.width,canvas.height);
    const result={source:canvas.toDataURL('image/jpeg',.94),ratio:canvas.height/canvas.width};
    canvas.width=canvas.height=1;
    return result;
}

// Create an actual PDF locally. It can be shared as a File in a Home Screen app,
// independently of Safari's HTML-blob printing and browser print-dialog support.
export async function createPdf(root,{onProgress=()=>{},isCurrent=()=>true}={}) {
    const pdf=new jsPDF({unit:'mm',format:'letter',compress:true,putOnlyUsedFonts:true});
    pdf.setProperties({title:'Workshop Cut Planner',subject:'Cutting and assembly plans',creator:'Workshop Cut Planner'});
    let used=false,y=MARGIN;
    const nextPage=()=>{if(used)pdf.addPage();used=true;y=MARGIN;};
    function lines(value,x,top,width,size=9,bold=false) {
        pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(30,41,59);
        const rows=pdf.splitTextToSize(text(value),width),height=size*.352778*1.2;
        pdf.text(rows,x,top+height*.8);
        return rows.length*height;
    }
    function writeTable(data,width,x,top,assembly=false) {
        if(!data)return top;
        autoTable(pdf,tableOptions(data,width,x,top,assembly));
        return pdf.lastAutoTable.finalY;
    }
    const cards=Array.from(root.querySelectorAll('.layout-grid>.sheet-card'));
    if(!cards.length)throw Error('No plans are available for PDF export.');
    for(let index=0;index<cards.length;index++) {
        if(!isCurrent())throw new DOMException('PDF preparation canceled.','AbortError');
        onProgress(`Preparing PDF ${index+1} of ${cards.length}…`);
        const card=cards[index],title=card.querySelector('h3')?.textContent||'Plan';
        if(card.classList.contains('print-assembly')) {
            const drawing=await drawingImage(card.querySelector('.assembly-print-image'));
            const leftWidth=(CONTENT-GAP)*.6,rightWidth=CONTENT-GAP-leftWidth,rightX=MARGIN+leftWidth+GAP;
            const reference=card.querySelector('.assembly-print-reference');
            const front=reference.querySelector('img'),frontImage=front?await loadImage(front.src):null;
            const data=tableData(card.querySelector('.assembly-print-parts table'));
            const tableHeight=measureTable(data,rightWidth,true);
            pdf.setFont('helvetica','bold');pdf.setFontSize(8);
            const parentRows=pdf.splitTextToSize(text(reference.querySelector('h4')?.textContent||''),rightWidth);
            const caption=reference.querySelector('p')?.textContent||'';
            const captionRows=pdf.splitTextToSize(text(caption),rightWidth);
            const frontHeight=frontImage?rightWidth*frontImage.naturalHeight/frontImage.naturalWidth:0;
            const referenceHeight=parentRows.length*3.4+frontHeight+(caption?captionRows.length*3.4+3:0)+4;
            const tableOnOwnPage=referenceHeight+tableHeight+9>HEIGHT-2*MARGIN-10;
            const asideHeight=frontImage?referenceHeight+(data&&!tableOnOwnPage?tableHeight+7:0):reference.querySelectorAll('li').length*4+8;
            pdf.setFontSize(11);
            const headingHeight=pdf.splitTextToSize(text(title),CONTENT).length*4.7;
            const cardHeight=headingHeight+4+Math.max(leftWidth*drawing.ratio,asideHeight)+4;
            if(!used||y+cardHeight>HEIGHT-MARGIN)nextPage();
            const top=y+lines(title,MARGIN,y,CONTENT,11,true)+3;
            pdf.addImage(drawing.source,'JPEG',MARGIN,top,leftWidth,leftWidth*drawing.ratio);
            let rightY=top+lines(reference.querySelector('h4')?.textContent,rightX,top,rightWidth,8,true)+2;
            if(frontImage) {
                pdf.addImage(frontImage,'PNG',rightX,rightY,rightWidth,frontHeight);
                rightY+=frontHeight+2;
                if(caption)rightY+=lines(caption,rightX,rightY,rightWidth,7)+3;
            } else {
                for(const item of reference.querySelectorAll('li'))rightY+=lines(item.textContent,rightX,rightY,rightWidth,7)+1;
            }
            if(data&&!tableOnOwnPage) {
                rightY+=lines('Parts',rightX,rightY,rightWidth,8,true)+2;
                rightY=writeTable(data,rightWidth,rightX,rightY,true);
            }
            y=Math.max(top+leftWidth*drawing.ratio,rightY)+GAP+2;
            if(data&&tableOnOwnPage) {
                nextPage();y+=lines('Parts - '+title,MARGIN,y,CONTENT,11,true)+3;
                y=writeTable(data,CONTENT,MARGIN,y,true)+GAP;
            }
        } else if(card.classList.contains('print-cover')) {
            nextPage();y+=lines(title,MARGIN,y,CONTENT,12,true)+4;
            const stats=Array.from(card.querySelectorAll('.stat'),stat=>[text(stat.querySelector('span')?.textContent),text(stat.querySelector('strong')?.textContent)]);
            if(stats.length)y=writeTable({head:[['Project summary','Value']],body:stats},CONTENT,MARGIN,y)+6;
            for(const table of card.querySelectorAll('table'))y=writeTable(tableData(table),CONTENT,MARGIN,y)+6;
            y=HEIGHT;
        } else {
            nextPage();y+=lines(title,MARGIN,y,CONTENT,11,true)+2;
            const note=card.querySelector(':scope>p')?.textContent;
            if(note)y+=lines(note,MARGIN,y,CONTENT,8)+3;
            const svg=card.querySelector('svg.diagram');
            const leftWidth=CONTENT*.54,rightX=MARGIN+leftWidth+GAP,rightWidth=WIDTH-MARGIN-rightX;
            if(svg) {
                const image=await drawingImage(svg),width=Math.min(leftWidth,(HEIGHT-MARGIN-y)/image.ratio);
                pdf.addImage(image.source,'JPEG',MARGIN,y,width,width*image.ratio);
            }
            let tableY=y;
            for(const block of card.querySelectorAll('.sheet-meta-block')) {
                const data=tableData(block.querySelector('table'));if(!data)continue;
                if(tableY>HEIGHT-MARGIN-12){nextPage();tableY=MARGIN;}
                tableY+=lines(block.querySelector('.sheet-meta-title')?.textContent?.replace(/Show|Hide/g,'')||'Cut details',rightX,tableY,rightWidth,8,true)+2;
                tableY=writeTable(data,rightWidth,rightX,tableY)+5;
            }
            y=HEIGHT;
        }
        // Yield between cards so the progress message paints on mobile.
        await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(!isCurrent())throw new DOMException('PDF preparation canceled.','AbortError');
    return new File([pdf.output('arraybuffer')],'workshop-cut-planner.pdf',{type:'application/pdf'});
}
