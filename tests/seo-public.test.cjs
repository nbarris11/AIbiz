const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('public sitemap, canonical links, fragments, schema, and assets stay valid',()=>{
  const result=spawnSync('python3',[path.join(root,'scripts/check-public-site.py')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
});

test('sample walkthrough advances, stops at reply, loops, and resets without network',()=>{
  const title={textContent:''},copy={textContent:''};
  const buttons={next:{},reset:{}};
  for(const button of Object.values(buttons))button.addEventListener=(type,handler)=>button.click=handler;
  const markers=Array.from({length:4},()=>({attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}}));
  const demo={classList:{add(){}},querySelector(s){return {'[data-demo-title]':title,'[data-demo-copy]':copy,'[data-demo-next]':buttons.next,'[data-demo-reset]':buttons.reset}[s];},querySelectorAll:()=>markers};
  vm.runInNewContext(fs.readFileSync(path.join(root,'content/insurance-workflow.js'),'utf8'),{document:{querySelector:()=>demo}});
  assert.equal(title.textContent,'Quote recorded');
  for(const name of ['Follow-up due','Staff review','Reply received']){buttons.next.click();assert.equal(title.textContent,name);}
  assert.match(copy.textContent,/Follow-up stops/);
  assert.equal(markers.filter(m=>m.attributes['aria-current']==='step').length,1);
  buttons.next.click();assert.equal(title.textContent,'Quote recorded');
  buttons.next.click();buttons.reset.click();assert.equal(title.textContent,'Quote recorded');
});

test('all public inline scripts compile',()=>{
  const files=fs.readdirSync(root).filter(f=>f.endsWith('.html')).concat(fs.readdirSync(path.join(root,'blog')).filter(f=>f.endsWith('.html')).map(f=>'blog/'+f));
  for(const file of files){
    const html=fs.readFileSync(path.join(root,file),'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      if(/application\/ld\+json/i.test(match[1]))JSON.parse(match[2]);
      else if(!/\bsrc\s*=/i.test(match[1]))assert.doesNotThrow(()=>new vm.Script(match[2]),file);
    }
  }
});
