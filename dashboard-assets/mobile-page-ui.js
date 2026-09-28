// Shared presentation helpers. Native filters, links and table buttons keep their listeners.
let panelId = 0;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mobilePhoto(playerId) {
  if (!playerId) return '';
  return `<img class="mobile-card-photo" src="https://cdn.nba.com/headshots/nba/latest/260x190/${encodeURIComponent(playerId)}.png" alt="" width="36" height="36" loading="lazy" decoding="async">`;
}

export function mobileDisclosure(panel, {title, open = false} = {}) {
  if (!panel || panel.dataset.mobileDisclosure) return;
  panel.dataset.mobileDisclosure = 'true';
  panel.classList.add('mobile-panel');
  panel.classList.toggle('is-mobile-open', open);
  let heading = panel.querySelector(':scope > .entity-section-heading');
  if (!heading) {
    heading = document.createElement('div'); heading.className = 'mobile-panel-heading';
    const existing = panel.querySelector(':scope > h2, :scope > h3');
    if (existing) heading.append(existing);
    else { const h = document.createElement('h2'); h.textContent = title; heading.append(h); }
    panel.prepend(heading);
  }
  heading.classList.add('mobile-panel-heading');
  const h = heading.querySelector('h2,h3');
  if (!h.id) h.id = `mobile-panel-title-${++panelId}`;
  const content = document.createElement('div'); content.className = 'mobile-panel-content';
  content.id = `mobile-panel-content-${++panelId}`;
  [...panel.childNodes].filter(node => node !== heading).forEach(node => content.append(node));
  const button = document.createElement('button'); button.type = 'button'; button.className = 'mobile-panel-toggle';
  button.setAttribute('aria-labelledby', `${h.id} ${content.id}-action`);
  button.setAttribute('aria-controls', content.id);
  const label = document.createElement('span'); label.id = `${content.id}-action`;button.append(label);
  const update = () => {
    const expanded = panel.classList.contains('is-mobile-open');
    button.setAttribute('aria-expanded', String(expanded));label.textContent = expanded ? 'Collapse −' : 'Expand +';
  };
  button.addEventListener('click', () => {
    const open = panel.classList.toggle('is-mobile-open');update();
    // A chart drawn while its panel was closed measured no width, so a page
    // that draws charts listens for this and redraws the panel it opened.
    panel.dispatchEvent(new CustomEvent('panel-toggle', {bubbles: true, detail: {open}}));
  });
  heading.append(button);panel.append(content);update();
}

export function prepareMobileTable(body, {kind = 'stats', main = 0, hidden = [], more = true} = {}) {
  if (!body) return;
  const table = body.closest('table'); if (!table) return;
  table.classList.add('mobile-card-table');table.dataset.cardKind = kind;
  table.setAttribute('role','table');
  const wrap = table.closest('.table-wrap');wrap?.classList.add('mobile-cards-wrap');
  // `more: false` keeps the hidden columns hidden with no button to show them.
  if (more && hidden.some(index=>![8,10].includes(index)) && !wrap?.previousElementSibling?.classList.contains('mobile-table-more')) {
    const more=document.createElement('button');more.type='button';more.className='mobile-table-more';more.textContent='More stats';more.setAttribute('aria-expanded','false');
    more.addEventListener('click',()=>{const open=table.classList.toggle('show-extra-stats');more.textContent=open?'Fewer stats':'More stats';more.setAttribute('aria-expanded',String(open));});wrap?.before(more);
  }
  const labels = [...table.querySelectorAll('thead tr:last-child th')].map(th => th.textContent.trim());
  const decorate = group => {
    if (!group) return;
    group.setAttribute('role','rowgroup');
    [...group.rows].forEach(row => {
      row.setAttribute('role','row');
      const empty = row.cells.length === 1 && row.cells[0].colSpan > 1;
      row.classList.toggle('mobile-card-empty', empty);
      if (kind==='player-games' && !row.querySelector('.mobile-game-open')) {
        const original=row.querySelector('[data-game-anatomy]');
        if(original){const button=original.cloneNode(true);button.className='mobile-game-open';button.textContent=row.cells[main].textContent;const date=document.createElement('span');date.className='desktop-game-date';date.textContent=row.cells[main].textContent;row.cells[main].replaceChildren(date,button);row.cells[main].classList.add('has-mobile-game-open');}
      }
      [...row.cells].forEach((cell,index) => {
        cell.setAttribute('role','cell');cell.dataset.label = labels[index] ?? '';
        cell.dataset.column = String(index);
        cell.classList.toggle('mobile-card-main', index === main && !empty);
        cell.classList.toggle('mobile-card-secondary', hidden.includes(index));
      });
    });
  };
  decorate(body);decorate(table.tFoot);
}

export function foldMobileNote(note, label = 'About this chart') {
  if (!note || note.parentElement?.classList.contains('mobile-note')) return;
  const wrap = document.createElement('div');wrap.className = 'mobile-note';
  const button = document.createElement('button');button.type = 'button';button.className='mobile-note-toggle';
  if (!note.id) note.id = `mobile-note-${++panelId}`;
  button.setAttribute('aria-controls',note.id);button.setAttribute('aria-expanded','false');button.textContent=label;
  note.before(wrap);wrap.append(button,note);
  button.addEventListener('click',()=>{const open=wrap.classList.toggle('is-open');button.setAttribute('aria-expanded',String(open));});
}

export function setupMobilePage() {
  document.querySelectorAll('.entity-profile .entity-panel:not(.profile-hero), #team-landscape-panel, .season-games-panel, .award-panel').forEach(panel => {
    const title = panel.querySelector('h2')?.textContent;
    // Every panel starts folded, the race cards too (owner's note, 2026-09-28),
    // except the Main Character race, which a phone opens on (a later note the
    // same day).
    if (title) mobileDisclosure(panel,{open:Boolean(panel.querySelector('#main-character-race'))});
  });
  const controls = document.querySelector('.entity-controls');
  if (controls) mobileDisclosure(controls,{title:'Filters',open:!new URLSearchParams(location.search).has('player_id')&&!new URLSearchParams(location.search).has('team_id')});
  document.querySelectorAll('#player-chart-note,#player-career-note,#team-chart-note,.chart-note.style-note,.chart-panels-note,#team-context-note,#team-roster-scope,#player-similarity-note,#team-similarity-note,.conservation-note').forEach(note=>foldMobileNote(note));
  document.addEventListener('error',event=>{
    if (!event.target.matches?.('.mobile-card-photo,.award-row > img')) return;
    event.target.hidden=true;
  },true);
}

export function mobileRosterSort(onSort) {
  const header = document.querySelector('#team-roster-body')?.closest('.entity-panel')?.querySelector('.entity-section-heading');
  if (!header || header.querySelector('.mobile-roster-sort')) return;
  const label=document.createElement('label');label.className='mobile-roster-sort';label.textContent='Sort players';
  const select=document.createElement('select');select.setAttribute('aria-label','Sort roster players');
  select.innerHTML=[['wins_contributed','Wins Contributed'],['value_contributed','Value Contributed'],['value_per_game','VC / game'],['offense','Offense'],['defense','Defense']].map(([key,name])=>`<option value="${key}">${name}</option>`).join('');
  select.addEventListener('change',()=>onSort(select.value));label.append(select);header.append(label);
}

// Numeric helpers are exported for missing-data/ordering checks without a DOM.
export function mobileLineModel(series) {
  const rows=series.map((s,index)=>({...s,key:String(s.key??s.player_id??index),segments:[]}));
  for (const row of rows) {
    let segment=[];
    for(const p of row.points??[]) {
      if(!p||p.value===null||p.value===undefined||!Number.isFinite(Number(p.value))||!Number.isFinite(Number(p.index))) {
        if(segment.length)row.segments.push(segment);segment=[];
      } else segment.push(p);
    }
    if(segment.length)row.segments.push(segment);
    row.last=row.segments.at(-1)?.at(-1)??null;
  }
  return rows.filter(row=>row.last);
}
const PALETTE=['#67b7ff','#ff766c','#ffdc58','#b899ff','#69dfad','#ff9ed5','#ffae51','#6fe8f2','#f5f0dc','#b9cc73'];
const lineState=new WeakMap();
// `invert` draws the lowest value on the top line (a gap to the leader, where
// no gap is best).
export function renderMobileLines(container, series, {xLabels=[],unit='',title='Contribution',recent=false,picker=true,scopeKey='',invert=false}={}) {
  container.querySelector(':scope > .mobile-page-lines')?.remove();
  container.classList.add('has-mobile-lines');
  const root=document.createElement('section');root.className='mobile-page-lines';root.setAttribute('aria-label',title);container.append(root);
  const rows=mobileLineModel(series);
  if(!rows.length){root.textContent='No values in this selection.';return;}
  const signature=scopeKey+'::'+rows.map(r=>r.key).join('|');
  let saved=lineState.get(container);
  if(!saved||saved.signature!==signature) saved={signature,checked:new Set((!picker?rows:recent?rows.slice(-5):rows.slice(0,5)).map(r=>r.key)),selected:null};
  lineState.set(container,saved);
  const all=rows.flatMap(r=>r.segments.flat());
  let lo=Math.min(0,...all.map(p=>Number(p.value))),hi=Math.max(0,...all.map(p=>Number(p.value)));
  if(lo===hi)hi=lo+1;
  const pad=(hi-lo)*.06;hi+=pad;if(lo<0)lo-=pad;
  const maxX=Math.max(1,...all.map(p=>Number(p.index))),x=p=>44+Number(p)/maxX*258,y=v=>invert?26+(Number(v)-lo)/(hi-lo)*248:274-(Number(v)-lo)/(hi-lo)*248;
  const labelFor=index=>{const l=xLabels[index];return l?.short||l?.label||String(l??index+1);};
  const number=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:3});
  const draw=()=>{
    const shown=rows.filter(r=>saved.checked.has(r.key));
    const colors=new Map(shown.map((r,i)=>[r.key,(PALETTE[i]||'#bfc8c4')]));
    if(!saved.checked.has(saved.selected))saved.selected=null;
    const ticks=[0,.333,.667,1].map(t=>lo+(hi-lo)*t);
    const xTicks=[...new Set([0,Math.round(maxX/3),Math.round(maxX*2/3),maxX])];
    root.innerHTML=`<svg viewBox="0 0 320 316" role="group" aria-label="${esc(title)}">${ticks.map(v=>`<line x1="44" x2="302" y1="${y(v)}" y2="${y(v)}" class="mobile-line-grid"/><text x="38" y="${y(v)+4}" text-anchor="end">${esc(Number(v.toFixed(2)))}</text>`).join('')}${xTicks.map(i=>`<text x="${x(i)}" y="299" text-anchor="${i===0?'start':i===maxX?'end':'middle'}">${esc(labelFor(i))}</text>`).join('')}${shown.map(r=>`<g data-line-key="${esc(r.key)}" role="button" tabindex="0" aria-label="Highlight ${esc(r.label)}" aria-pressed="${saved.selected===r.key}" style="--line-color:${colors.get(r.key)};opacity:${saved.selected&&saved.selected!==r.key?'.18':'1'}">${r.segments.map(segment=>{const d=segment.map((p,i)=>`${i?'L':'M'}${x(p.index)},${y(p.value)}`).join(' ');return `<path class="mobile-line-hit" d="${d}"/><path class="mobile-line-path" d="${d}" style="stroke-width:${saved.selected===r.key?4:2}"/>${segment.length===1?`<circle cx="${x(segment[0].index)}" cy="${y(segment[0].value)}" r="3" fill="${colors.get(r.key)}"/>`:''}`;}).join('')}</g>`).join('')}</svg><p class="mobile-line-unit">${esc(unit)}</p><div class="mobile-line-readout" aria-live="polite"${saved.selected?'':' hidden'}></div><div class="mobile-line-list"></div>`;
    const toggle=key=>{saved.selected=saved.selected===key?null:key;draw();[...root.querySelectorAll('.mobile-line-name')].find(b=>b.dataset.lineName===key)?.focus({preventScroll:true});};
    const readout=root.querySelector('.mobile-line-readout');
    const selected=shown.find(r=>r.key===saved.selected);
    if(selected)readout.textContent=`${selected.label} · ${selected.last.tooltip??labelFor(selected.last.index)} · ${number(selected.last.value)} ${unit}`;
    const ordered=[...shown].sort((a,b)=>(b.key===saved.selected)-(a.key===saved.selected));
    const list=root.querySelector('.mobile-line-list');
    ordered.forEach(r=>{const b=document.createElement('button');b.type='button';b.className='mobile-line-name';b.dataset.lineName=r.key;b.setAttribute('aria-pressed',String(saved.selected===r.key));b.style.setProperty('--line-color',colors.get(r.key));b.innerHTML=`<span>${esc(r.label)}</span><strong>${esc(number(r.last.value))}</strong>`;b.addEventListener('click',()=>toggle(r.key));list.append(b);});
    root.querySelectorAll('[data-line-key]').forEach(mark=>{
      mark.addEventListener('click',()=>toggle(mark.dataset.lineKey));
      mark.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();toggle(mark.dataset.lineKey);}});
    });
    if(picker&&rows.length>1){
      const details=document.createElement('details');details.className='mobile-line-picker';details.open=Boolean(saved.pickerOpen);
      details.innerHTML=`<summary>Select ${recent?'seasons':'lines'} <small>${shown.length} selected</small></summary><div>${rows.map(r=>`<label><input type="checkbox" value="${esc(r.key)}" ${saved.checked.has(r.key)?'checked':''} ${shown.length>=10&&!saved.checked.has(r.key)?'disabled':''}>${esc(r.label)}</label>`).join('')}</div>`;
      details.addEventListener('toggle',()=>{saved.pickerOpen=details.open;});
      details.addEventListener('change',e=>{if(e.target.checked)saved.checked.add(e.target.value);else saved.checked.delete(e.target.value);saved.pickerOpen=true;draw();});root.append(details);
    }
    if(!shown.length)list.textContent='Select a line below to start.';
  };
  draw();
}

export function seasonStepper(select) {
  select.parentElement.classList.add('has-season-stepper');
  let stepper=select.parentElement.querySelector('.mobile-season-stepper');
  if(!stepper){
    stepper=document.createElement('div');stepper.className='mobile-season-stepper';
    const previous=document.createElement('button'), next=document.createElement('button'), current=document.createElement('output');
    previous.type=next.type='button';previous.textContent='‹ Previous';next.textContent='Next ›';current.setAttribute('aria-live','polite');
    const update=()=>{current.textContent=select.selectedOptions[0]?.textContent??'';previous.disabled=select.selectedIndex>=select.options.length-1;next.disabled=select.selectedIndex<=0;};
    const step=delta=>{const index=select.selectedIndex+delta;if(index<0||index>=select.options.length)return;select.selectedIndex=index;select.dispatchEvent(new Event('change',{bubbles:true}));};
    previous.addEventListener('click',()=>step(1));next.addEventListener('click',()=>step(-1));select.addEventListener('change',update);
    stepper.append(previous,current,next);select.after(stepper);stepper.update=update;
  }
  stepper.update();
}
