/**
 * OA Smart Assistant: export persisted operational reports (no extra npm packages).
 * Reports are descriptive analytics, NOT the separate 100-question LLM evaluation.
 * DOCX is generated as a standard, uncompressed OOXML ZIP, entirely in the browser.
 */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeXml = (value) => String(value ?? '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export {academicReportData} from '../../shared/reportData.mjs';
import {academicReportData} from '../../shared/reportData.mjs';

function htmlTable(headers, rows) {
  return `<table><thead><tr>${headers.map((s) => `<th>${escapeHtml(s)}</th>`).join('')}</tr></thead><tbody>${(rows.length ? rows : [headers.map((_,i) => i===0?'—':i===1?'Даних немає':'—')]).map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function academicReportHtml(report) {
  const d = academicReportData(report);
  const css = `
    @page { size: A4; margin: 19mm 19mm 17mm; }
    * { box-sizing:border-box; }
    body { margin:0; color:#172c34; background:#fff; font-family:Arial, 'Segoe UI', sans-serif; font-size:11pt; line-height:1.5; }
    .sheet { max-width:820px; margin:auto; padding:30px 32px 45px; }
    .masthead { border-bottom:3px solid #116a62; padding-bottom:16px; margin-bottom:30px; display:flex; justify-content:space-between; gap:16px; }
    .institution { font-size:10pt; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#144c4b; }
    .doc-tag { font-size:9pt; color:#52666c; text-align:right; }
    h1 { font-family:Georgia, 'Times New Roman', serif; font-size:19pt; line-height:1.25; text-align:center; color:#163f40; margin:0 0 12px; }
    .subtitle { text-align:center; color:#536973; margin-bottom:24px; }
    .identity { background:#f1f7f6; border-left:3px solid #16867a; padding:12px 17px; margin-bottom:27px; }
    .identity div { margin:3px 0; }
    h2 { color:#164e4c; font-size:12pt; margin:25px 0 9px; page-break-after:avoid; }
    table { width:100%; border-collapse:collapse; margin:10px 0 19px; font-size:10pt; }
    th,td { padding:8px 10px; border:1px solid #cfdcda; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th { background:#e6f1ef; color:#194f4b; font-weight:700; }
    tbody tr:nth-child(even) { background:#fafcfc; }
    p { text-align:justify; margin:6px 0 13px; }
    .notes { color:#435861; font-size:9.5pt; }
    .footer { margin-top:24px; padding-top:13px; border-top:1px solid #c9dad8; color:#536973; font-size:9pt; }
    @media screen { body { background:#e8efee; padding:24px; } .sheet { background:white; border-radius:8px; box-shadow:0 18px 50px #193e4022; } }
    @media print { body { padding:0; } .sheet { padding:0; max-width:none; box-shadow:none; } tr { page-break-inside:avoid; } }
  `;
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(d.title)} — ${escapeHtml(d.period)}</title><style>${css}</style></head><body><article class="sheet">
    <div class="masthead"><div class="institution">${escapeHtml(d.institution)}</div><div class="doc-tag">Внутрішній аналітичний документ</div></div>
    <h1>${escapeHtml(d.title)}</h1><div class="subtitle">${escapeHtml(d.subtitle)}</div>
    <div class="identity"><div><b>Тип:</b> ${escapeHtml(d.type)}</div><div><b>Звітний період:</b> ${escapeHtml(d.period)}</div><div><b>Сформовано:</b> ${escapeHtml(d.generated)} (Київ)</div><div><b>Ідентифікатор:</b> ${escapeHtml(d.reportId)}</div></div>
    <h2>1. Предмет і джерела аналізу</h2><p>${escapeHtml(d.methodology)}</p>
    <h2>2. Основні кількісні показники</h2>${htmlTable(['Показник','Значення'],d.metrics)}
    <h2>3. Структура відповідей за способом обробки</h2>${htmlTable(['Спосіб обробки','Кількість','Частка'],d.sourceRows)}
    <h2>4. Зворотний зв’язок</h2>${htmlTable(['Показник','Кількість','Частка оцінок'],d.feedbackRows)}
    <h2>5. Найчастіші формулювання запитань</h2>${htmlTable(['№','Запитання','Кількість'],d.questions)}
    <h2>6. Тематичний розподіл</h2>${htmlTable(['№','Тематика','Кількість'],d.intents)}
    <h2>7. Обмеження інтерпретації</h2><p class="notes">${escapeHtml(d.limitations)}</p>
    <h2>8. Фактичний висновок</h2><p>${escapeHtml(d.conclusion)}</p>
    <div class="footer">OA Smart Assistant · автоматично згенерований звіт. Перед зовнішнім використанням перевірити персональні дані та обґрунтованість висновків.</div>
    </article></body></html>`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function safeFileName(report) {
  const period = String(report.periodLabel || 'period').replace(/[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ-]+/g, '_').slice(0, 70);
  return `OA_Smart_Assistant_${report.type === 'monthly' ? 'month' : 'week'}_${period}`;
}
export function downloadAcademicHtml(report) {
  downloadBlob(new Blob(['\ufeff', academicReportHtml(report)], { type: 'text/html;charset=utf-8' }), `${safeFileName(report)}.html`);
}
export function printAcademicReport(report) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Браузер заблокував вікно друку. Дозвольте спливаючі вікна.');
  popup.document.open(); popup.document.write(academicReportHtml(report)); popup.document.close();
  popup.addEventListener('load', () => { popup.focus(); popup.print(); }, { once: true });
}

// A minimal, valid OPC ZIP for DOCX; no CDN, credentials or external dependencies.
const enc = new TextEncoder();
const u16 = (dv, offset, v) => dv.setUint16(offset, v, true);
const u32 = (dv, offset, v) => dv.setUint32(offset, v >>> 0, true);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k=0;k<8;k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, xml] of Object.entries(entries)) {
    const filename = enc.encode(name), data = enc.encode(xml), crc = crc32(data);
    const local = new Uint8Array(30 + filename.length + data.length), lh = new DataView(local.buffer);
    u32(lh,0,0x04034b50); u16(lh,4,20); u16(lh,6,0x0800); u16(lh,8,0);
    u32(lh,14,crc); u32(lh,18,data.length); u32(lh,22,data.length); u16(lh,26,filename.length);
    local.set(filename,30); local.set(data,30+filename.length); locals.push(local);
    const central = new Uint8Array(46 + filename.length), ch = new DataView(central.buffer);
    u32(ch,0,0x02014b50); u16(ch,4,20); u16(ch,6,20); u16(ch,8,0x0800); u16(ch,10,0);
    u32(ch,16,crc); u32(ch,20,data.length); u32(ch,24,data.length); u16(ch,28,filename.length); u32(ch,42,offset);
    central.set(filename,46); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum,a)=>sum+a.length,0);
  const end = new Uint8Array(22), ed = new DataView(end.buffer);
  u32(ed,0,0x06054b50); u16(ed,8,centrals.length); u16(ed,10,centrals.length); u32(ed,12,centralSize); u32(ed,16,offset);
  const out = new Uint8Array(offset+centralSize+end.length);
  let pos=0;
  for (const a of [...locals,...centrals,end]) {out.set(a,pos);pos+=a.length;}
  return out;
}
const wText = (value,bold=false) => `<w:r><w:rPr>${bold?'<w:b/>':''}<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
const wPara = (text, opts={}) => `<w:p><w:pPr><w:pStyle w:val="${opts.style || 'Normal'}"/>${opts.align?`<w:jc w:val="${opts.align}"/>`:''}${opts.keep?'<w:keepNext/>':''}</w:pPr>${wText(text, Boolean(opts.bold))}</w:p>`;
const wCell = (text,header=false,width=2400) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header?'<w:shd w:fill="EAF2F1"/>':''}<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="CEDBD9"/></w:tcBorders></w:tcPr>${wPara(text,{bold:header})}</w:tc>`;
function wTable(headers,rows) {
  const widths = headers.length === 2 ? [7300,2300] : [1500,6100,2000];
  const header = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${headers.map((h,i)=>wCell(h,true,widths[i])).join('')}</w:tr>`;
  const rowsXml = (rows.length?rows:[headers.map((_,i)=>i===0?'—':i===1?'Даних немає':'—')]).map(row=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${headers.map((_,i)=>wCell(row[i]??'',false,widths[i])).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="88ABA6"/><w:bottom w:val="single" w:sz="6" w:color="88ABA6"/></w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:start w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:end w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${header}${rowsXml}</w:tbl>`;
}
export function academicReportDocxBytes(report) {
  const d = academicReportData(report);
  const doc = [
    wPara(d.institution,{bold:true,align:'center'}),
    wPara(d.title,{style:'Title',align:'center'}),
    wPara(d.subtitle,{align:'center'}),
    wPara(`Тип звіту: ${d.type}  |  Період: ${d.period}`),
    wPara(`Сформовано: ${d.generated} (Київ)  |  Ідентифікатор: ${d.reportId}`),
    wPara('1. Предмет і джерела аналізу',{style:'Heading1',keep:true}),wPara(d.methodology),
    wPara('2. Основні кількісні показники',{style:'Heading1',keep:true}),wTable(['Показник','Значення'],d.metrics),
    wPara('3. Структура відповідей за способом обробки',{style:'Heading1',keep:true}),wTable(['Спосіб обробки','Кількість','Частка'],d.sourceRows),
    wPara('4. Зворотний зв’язок',{style:'Heading1',keep:true}),wTable(['Показник','Кількість','Частка оцінок'],d.feedbackRows),
    wPara('5. Найчастіші формулювання запитань',{style:'Heading1',keep:true}),wTable(['№','Запитання','Кількість'],d.questions),
    wPara('6. Тематичний розподіл',{style:'Heading1',keep:true}),wTable(['№','Тематика','Кількість'],d.intents),
    wPara('7. Обмеження інтерпретації',{style:'Heading1',keep:true}),wPara(d.limitations),
    wPara('8. Фактичний висновок',{style:'Heading1',keep:true}),wPara(d.conclusion),
  ].join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${doc}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1077" w:bottom="1134" w:left="1134" w:header="709" w:footer="709"/></w:sectPr></w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="110" w:line="285" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="320" w:after="230"/></w:pPr><w:rPr><w:b/><w:color w:val="174D48"/><w:sz w:val="31"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="260" w:after="100"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="174D48"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`;
  return makeZip({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': document,
    'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': styles,
  });
}
export function downloadAcademicDocx(report) {
  downloadBlob(new Blob([academicReportDocxBytes(report)], { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${safeFileName(report)}.docx`);
}
