#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const items = Object.values(require('../src/game/catalog/items.json').items);
const output = '/tmp/frpg-item-review';
fs.mkdirSync(output, { recursive: true });
for (const category of new Set(items.map(item => item.category))) {
  const selected = items.filter(item => item.category === category);
  if (!selected.every(item => fs.existsSync(path.join(root, `assets/items/${item.definitionId}.png`)))) continue;
  const args = ['-font', 'DejaVu-Sans', '-pointsize', '11', '-fill', '#e8e1cc', '-background', '#18241f'];
  for (const item of selected) args.push('-label', item.definitionId, path.join(root, `assets/items/${item.definitionId}.png`));
  args.push('-filter', 'Point', '-resize', '128x128', '-tile', '6x4', '-geometry', '160x150+6+10', path.join(output, `${category}.png`));
  execFileSync('montage', args);
}
const data = JSON.stringify(items).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Items · art catalog</title><style>
:root{color-scheme:dark;font:15px/1.5 system-ui;background:#101a16;color:#e8e1cc}body{margin:0;padding:28px;max-width:1500px;margin:auto}h1{margin:0}p{color:#a7b3a3}header{position:sticky;top:0;background:#101a16ed;padding:12px 0;z-index:2;backdrop-filter:blur(8px)}nav{display:flex;gap:12px;flex-wrap:wrap}input,select,button{font:inherit;background:#253329;color:inherit;border:1px solid #465242;padding:10px;border-radius:8px}input{flex:1;min-width:190px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}article{background:#18241f;border:1px solid #344434;border-radius:12px;padding:16px;overflow:hidden}img{image-rendering:pixelated;object-fit:contain;width:var(--icon,128px);height:var(--icon,128px);display:block;margin:10px auto}h2{font-size:15px;margin:8px 0}small{color:#b2bca8}.rare{border-color:#9479bb}.uncommon{border-color:#649873}details{font-size:13px;margin-top:10px}summary{cursor:pointer;color:#b4cea9}.stats{color:#c9d7ba;font-size:13px}#count{margin:12px 0}
</style><h1>Spoils of the road</h1><p>${items.length} named items · actual 64×64 game icons · click Appearance for the authored description.</p>
<header><nav><input id="search" aria-label="Search items" placeholder="Search items or materials"><select id="category" aria-label="Category"><option value="">All categories</option></select><select id="rarity" aria-label="Rarity"><option value="">All rarities</option><option>common</option><option>uncommon</option><option>rare</option></select><select id="size" aria-label="Icon display size"><option value="64">64px · native</option><option value="128" selected>128px · 2×</option><option value="256">256px · 4×</option></select></nav><p id="count"></p></header><main></main><script>
const items=${data};
const $=selector=>document.querySelector(selector);
const modifierLabel=({stat,value})=>{const pct=n=>Number(n.toFixed(2))+'%';switch(stat){case 'health':return '+'+value+' health';case 'armor':return '+'+value+' armor';case 'damage':return '+'+value+' damage';case 'pushup_damage_coefficient':return '+'+pct(value*100)+' damage per pushup';case 'crit_chance_bps':return '+'+pct(value/100)+' crit chance';case 'crit_damage_bps':return '+'+pct(value/100)+' crit damage';}};
for(const category of new Set(items.map(item=>item.category))){const option=document.createElement('option');option.value=category;option.textContent=category.replaceAll('_',' ');$('#category').append(option);}
function draw(){const query=$('#search').value.toLowerCase();const selected=items.filter(item=>(!$('#category').value||item.category===$('#category').value)&&(!$('#rarity').value||item.rarity===$('#rarity').value)&&(item.name+' '+item.visualDescription).toLowerCase().includes(query));$('main').replaceChildren();$('#count').textContent=selected.length+' items';document.documentElement.style.setProperty('--icon',$('#size').value+'px');for(const item of selected){const card=document.createElement('article');card.className=item.rarity;const label=document.createElement('small');label.textContent=item.rarity+' · tier '+item.tier;const img=document.createElement('img');img.src='../../../assets/items/'+item.definitionId+'.png';img.alt=item.name;img.loading='lazy';const name=document.createElement('h2');name.textContent=item.name;const stats=document.createElement('p');stats.className='stats';stats.textContent=[item.damageMin!==undefined?item.damageMin+'–'+item.damageMax+' damage':'',item.armor?item.armor+' armor':'',...item.modifiers.map(modifierLabel)].filter(Boolean).join(' · ');const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Appearance';const prose=document.createElement('p');prose.textContent=item.visualDescription;detail.append(summary,prose);card.append(label,img,name,stats,detail);$('main').append(card);}}
for(const id of ['search','category','rarity','size'])$('#'+id).addEventListener('input',draw);draw();
</script></html>`;
fs.writeFileSync(path.join(root, 'image-generation/items/v1/review.html'), html);
console.log(`Item catalog review written; completed-category contact sheets: ${output}`);
