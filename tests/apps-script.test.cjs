// Tests apps-script/Code.gs in Node with a small fake of the Sheets/Forms services:
//  1. data.json -> sheet rows -> data.json round-trips exactly
//  2. simulated form submissions update the right rows and land in the right place
// Run: npm run test:apps-script
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const path=require('path'); const ROOT=path.resolve(__dirname,'..');
const book={};
// --- minimal SpreadsheetApp mock over 2D arrays
function sheet(name){const d=book[name];return{
 getDataRange:()=>({getValues:()=>d.map(r=>r.slice())}),
 getLastRow:()=>d.length,getLastColumn:()=>d[0].length,
 getRange:(r,c,nr=1,nc=1)=>({getValues:()=>d.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc)),
   setValues:v=>v.forEach((row,i)=>{d[r-1+i]=d[r-1+i]||Array(d[0].length).fill('');row.forEach((x,j)=>d[r-1+i][c-1+j]=x)}),
   setValue:v=>{d[r-1][c-1]=v},setNumberFormats:()=>{},setNumberFormat:()=>{}}),
}}
const props={};
const ctx={console,Math,Date,JSON,String,Number,Array,Object,RegExp,
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:sheet,getUrl:()=>'x'}),openById:()=>({getSheetByName:sheet,getUrl:()=>'x'})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Session:{getScriptTimeZone:()=>'America/New_York'},
 Maps:{newGeocoder:()=>({setRegion(){return this},geocode:()=>({status:'OK',results:[{geometry:{location:{lat:42.28,lng:-71.35}}}]})})},
};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(ROOT+'/apps-script/Code.gs','utf8'),ctx);
const orig=JSON.parse(fs.readFileSync(ROOT+'/public/data.json'));
// seed the mock workbook with the Apps Script's own seeding function (not the xlsx)
const COLS=vm.runInContext('COLS',ctx); const seeded=ctx.sheetRowsFromData_(orig);
for(const k of Object.keys(COLS)) book[k]=[COLS[k].slice()].concat(JSON.parse(JSON.stringify(seeded[k]||[])));


// 1) round trip: sheet -> data.json matches current data
const out=ctx.buildDataFile_(ctx.readAll_(),'now');
const norm=d=>({c:d.coalitions.map(c=>({...c,lat:0,lng:0,member_ids:[...c.member_ids].sort()})),
 o:d.organizations.map(o=>({...o,lat:0,lng:0})),
 e:d.edges.map(e=>e.source+'>'+e.target).sort()});
const J=x=>JSON.parse(JSON.stringify(x));assert.deepStrictEqual(J(norm(out)),J(norm(orig))); out.organizations.forEach((o,i)=>{assert.ok(Math.abs(o.lat-orig.organizations[i].lat)<1e-4&&Math.abs(o.lng-orig.organizations[i].lng)<1e-4)});console.log('round trip OK');

// 2) simulate submissions
props.FORM_ORG='fo';props.FORM_EVENT='fe';props.FORM_PROJECT='fp';props.FORM_FEEDBACK='ff';
ctx.refreshDropdowns=()=>{};
const submit=(fid,ans)=>ctx.handleSubmit({source:{getId:()=>fid},response:{getItemResponses:()=>Object.entries(ans).map(([k,v])=>({getItem:()=>({getTitle:()=>k}),getResponse:()=>v}))}});
const Q=vm.runInContext('Q',ctx), NEW_EVENT=vm.runInContext('NEW_EVENT',ctx), NEW_ORG=vm.runInContext('NEW_ORG',ctx);
// edit org: only description + tags; everything else untouched
submit('fo',{[Q.whichOrg]:'Boston Latin School Youth Climate Action Network [boston_latin_school_youthcan]',[Q.orgDesc]:'New description',[Q.tags]:['Clean energy','Tree planting'],[Q.youth]:'Yes',[Q.logo]:'https://drive.google.com/file/d/abc123/view?usp=sharing',[Q.submitter]:'Sam s@x.org'});
// new org with town + coalition
submit('fo',{[Q.whichOrg]:NEW_ORG,[Q.orgName]:'Natick Climate Circle',[Q.orgTown]:'Natick',[Q.orgCoalitions]:['Massachusetts Youth Climate Coalition (MYCC) [mycc]'],[Q.publicContact]:'hi@ncc.org'});
// new event hosted by new org, no coalition
submit('fe',{[Q.whichEvent]:NEW_EVENT,[Q.hostOrg]:'Natick Climate Circle [natick_climate_circle]',[Q.eventName]:'Song Circle for the Planet',[Q.eventDate]:'2026-10-18',[Q.eventTime]:'15:00',[Q.eventLocation]:'Natick Common',[Q.eventDesc]:'Singing together.'});
// edit existing event: time only
submit('fe',{[Q.whichEvent]:'MYCC Steering Meeting — Jun 12, 2026 [mycc_e1]',[Q.eventTime]:'19:30'});
// remove a project
submit('fp',{[Q.whichProject]:'Youth Summit 2026 [mycc_p2]',[Q.remove]:['Yes, take it off the map']});
submit('fp',{[Q.whichProject]:vm.runInContext('NEW_PROJECT',ctx),[Q.hostOrg]:'Natick Climate Circle [natick_climate_circle]',[Q.coalition]:'MA Youth Climate Coalition (MYCC) [mycc]',[Q.projectName]:'Joint Tree Drive'});
submit('fe',{[Q.whichEvent]:NEW_EVENT,[Q.eventName]:'Orphan Event'});
submit('ff',{[Q.fbType]:'Idea or feature request',[Q.fbArea]:['Events list'],[Q.fbMessage]:'Add a calendar export'});
const d2=ctx.buildDataFile_(ctx.readAll_(),'now');
const org=d2.organizations.find(o=>o.id==='boston_latin_school_youthcan');
assert.equal(org.description,'New description'); assert.equal(org.abbrev,'BLS YouthCAN'); assert.equal(org.profile.youth_serving,true); assert.equal(org.logo,'https://drive.google.com/thumbnail?id=abc123&sz=w400'); assert.deepEqual(J(org.topic_tags),['clean_energy','tree_planting']); assert.equal(org.name,'Boston Latin School Youth Climate Action Network');
const n=d2.organizations.find(o=>o.id==='natick_climate_circle'); assert.ok(n&&n.coalition_ids[0]==='mycc'&&n.public_contact==='hi@ncc.org'&&Math.abs(n.lat-42.28)<0.02);
const mycc=d2.coalitions.find(c=>c.id==='mycc');
assert.ok(mycc.member_ids.includes('natick_climate_circle'));
const natick=d2.organizations.find(o=>o.id==='natick_climate_circle');
assert.ok(!mycc.events.find(e=>e.name==='Song Circle for the Planet'),'org-owned event must not sit under a coalition');
const ev=(natick.events||[]).find(e=>e.name==='Song Circle for the Planet'); assert.ok(ev,'org-owned event on org'); assert.equal(ev.date,'2026-10-18T15:00:00'); assert.equal(ev.host_org_id,'natick_climate_circle');
assert.equal(mycc.events.find(e=>e.id==='mycc_e1').date,'2026-06-12T19:30:00');
assert.ok(!mycc.projects.find(p=>p.id==='mycc_p2'));
const jt=mycc.projects.find(p=>p.name==='Joint Tree Drive'); assert.ok(jt&&jt.host_org_id==='natick_climate_circle','coalition project hosted by org');
assert.ok(!JSON.stringify(d2).includes('Orphan Event'),'orphan left off map');
// second round trip: data.json with org-owned items -> sheet rows -> data.json
const again=ctx.buildDataFile_((()=>{const rows=ctx.sheetRowsFromData_(JSON.parse(JSON.stringify(d2)));const obj=(k)=>rows[k].map(r=>Object.fromEntries(COLS[k].map((c,i)=>[c,r[i]])));return {coalitions:obj('Coalitions'),orgs:obj('Organizations'),projects:obj('Projects'),events:obj('Events'),actions:obj('Actions')};})(),'now');
assert.deepStrictEqual(J(again.organizations.find(o=>o.id==='natick_climate_circle').events),J(natick.events)); console.log('org-owned round trip OK');
console.log('feedback rows',book['Feedback'].length-1);
console.log(book['Change Log'].slice(1).map(r=>r.slice(1,6).join(' | ')+'\n    '+String(r[6]).replace(/\n/g,'\n    ')).join('\n'));
console.log('submissions OK');
