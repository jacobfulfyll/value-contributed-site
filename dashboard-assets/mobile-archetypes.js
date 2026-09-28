// Mobile presentation of the published archetype coordinates and assignments.
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, text) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (text !== undefined) el.textContent = text;
  return el;
};
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const fold = value => globalThis.ValueContributedNameFold?.foldName(value)
  ?? String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
let instance = 0;

export function archetypeViewModel(rows, catalog) {
  const placed = rows.filter(row => [row.type_x, row.type_y].every(value => value !== null && value !== undefined && Number.isFinite(Number(value))));
  const types = (catalog.types ?? []).map(type => ({...type, count: placed.filter(row => row.style.id === type.id).length}));
  for (const row of placed) if (!types.some(type => type.id === row.style.id)) {
    types.push({...row.style, count: placed.filter(other => other.style.id === row.style.id).length});
  }
  const bounds = key => {
    const values = placed.map(row => Number(row[key]));
    const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi-lo)*.13, .5);
    return placed.length ? [lo-pad, hi+pad] : [-1,1];
  };
  return {rows: placed, types, xDomain: bounds("type_x"), yDomain: bounds("type_y")};
}

export function renderMobileArchetypes(container, rows, catalog, {hrefFor, highlightsFor, fitFor}) {
  container.querySelector(":scope > .mobile-archetypes")?.remove();
  container.classList.add("has-mobile-preview");
  const root = document.createElement("section");
  root.className = "mobile-preview mobile-archetypes";
  root.setAttribute("aria-label", "Explore player archetypes");
  container.append(root);
  const model = archetypeViewModel(rows, catalog);
  if (!model.rows.length) {root.textContent = "No published player descriptions in this selection.";return;}
  const uid = ++instance;
  let activeType = null, selected = null;
  const search = document.createElement("label");
  search.className = "mobile-archetype-search";
  search.innerHTML = 'Find a player<input type="search" aria-label="Find an archetype player" placeholder="Search names" autocomplete="off">';
  const input = search.querySelector("input");
  const filters = document.createElement("div");
  filters.className = "mobile-archetype-filters";
  filters.setAttribute("role", "group"); filters.setAttribute("aria-label", "Focus an archetype");
  const typeDetail = document.createElement("p");
  typeDetail.className = "mobile-archetype-type-detail";
  typeDetail.setAttribute("role", "status");
  const chart = svg("svg", {viewBox:"0 0 320 350", role:"group", "aria-label":"Player archetypes at their published season-profile coordinates"});
  const x = value => 30 + (Number(value)-model.xDomain[0])/(model.xDomain[1]-model.xDomain[0])*272;
  const y = value => 316 - (Number(value)-model.yDomain[0])/(model.yDomain[1]-model.yDomain[0])*294;
  chart.append(svg("rect", {x:20,y:12,width:292,height:316,rx:14,class:"mobile-archetype-plot"}));
  for (let i=1;i<4;i++) {
    chart.append(svg("line", {x1:20,x2:312,y1:12+i*79,y2:12+i*79,class:"mobile-archetype-grid"}),
      svg("line", {x1:20+i*73,x2:20+i*73,y1:12,y2:328,class:"mobile-archetype-grid"}));
  }
  chart.append(svg("text",{x:30,y:344,class:"mobile-archetype-axis"},"Season profile →"));
  const defs = svg("defs"), marksLayer = svg("g"); chart.append(defs,marksLayer);
  const radius = 12;
  const marks = model.rows.map((row,index) => {
    const cx=x(row.type_x), cy=y(row.type_y), clipId=`mobile-archetype-${uid}-${index}`;
    const clip=svg("clipPath",{id:clipId});clip.append(svg("circle",{cx,cy,r:radius}));defs.append(clip);
    const mark=svg("g",{class:"mobile-archetype-player", "data-archetype-index":index,role:"button",tabindex:0,
      "aria-label":`${row.display_name}, ${row.season ?? ""}, ${row.style.label}`,"aria-pressed":"false"});
    mark.style.setProperty("--type-color",row.style.color);
    const initials=svg("text",{x:cx,y:cy+4,"text-anchor":"middle",class:"mobile-archetype-initials",visibility:"hidden"},row.display_name.split(" ").map(s=>s[0]).slice(0,2).join(""));
    const photo=svg("image",{href:`https://cdn.nba.com/headshots/nba/latest/260x190/${encodeURIComponent(row.entity_id)}.png`,x:cx-radius,y:cy-radius,width:radius*2,height:radius*2,preserveAspectRatio:"xMidYMid slice","clip-path":`url(#${clipId})`});
    photo.addEventListener("error",()=>{photo.remove();initials.setAttribute("visibility","visible");});
    mark.append(svg("circle",{cx,cy,r:radius,class:"mobile-archetype-face-back"}),initials,photo,
      svg("circle",{cx,cy,r:radius+1,class:"mobile-archetype-ring"}),
      svg("rect",{x:cx-8,y:cy+9,width:16,height:10,rx:3,class:"mobile-archetype-badge"}),
      svg("text",{x:cx,y:cy+16.5,"text-anchor":"middle",class:"mobile-archetype-badge-text"},row.style.badge));
    marksLayer.append(mark); return mark;
  });
  const detail=document.createElement("div");detail.className="mobile-archetype-detail";detail.hidden=true;detail.setAttribute("aria-live","polite");
  const reading=document.createElement("details");reading.className="mobile-archetype-reading";
  const directions=[catalog.axes?.type_x?.high ? `To the right: ${catalog.axes.type_x.high}.` : "", catalog.axes?.type_y?.high ? `Toward the top: ${catalog.axes.type_y.high}.` : ""].filter(Boolean);
  reading.innerHTML=`<summary>How to read this map</summary><p>Color and the small letter badge identify each archetype. Selecting a type fades the others while positions stay fixed. The map describes season profiles, not player rankings.</p>${directions.map(text=>`<p>${escape(text)}</p>`).join("")}`;
  const buttons=[];
  const update = () => {
    const type = model.types.find(item=>item.id===activeType);
    buttons.forEach(({button,id})=>button.setAttribute("aria-pressed",String(activeType===id)));
    typeDetail.textContent = type ? `${type.label} · ${type.count} player season${type.count===1?"":"s"}. ${type.description}`
      : `${model.rows.length} player seasons · ${model.types.filter(t=>t.count).length} archetypes`;
    marks.forEach((mark,index)=>{
      const row=model.rows[index], active=selected===index;
      mark.style.opacity=active ? "1" : selected!==null ? ".25" : activeType && row.style.id!==activeType ? ".12" : "1";
      mark.classList.toggle("is-selected",active);mark.setAttribute("aria-pressed",String(active));
    });
    detail.hidden=selected===null;
    if (selected===null) {detail.replaceChildren();return;}
    const row=model.rows[selected];marksLayer.append(marks[selected]);
    detail.style.setProperty("--type-color",row.style.color);
    const traits=highlightsFor(row);
    detail.innerHTML=`<a href="${escape(hrefFor(row))}">${escape(row.display_name)}</a><span class="mobile-archetype-player-season">${escape(row.season ?? "")}</span><strong class="mobile-archetype-type-name">${escape(row.style.badge)} · ${escape(row.style.label)}</strong><p>${escape(fitFor(row))}${row.style.provisional ? " · Limited minutes" : ""}</p>${traits.length?`<ul>${traits.map(text=>`<li>${escape(text)}</li>`).join("")}</ul>`:""}`;
  };
  const choices=[{id:null,label:"All",count:model.rows.length,color:"#17382e"},...model.types.filter(type=>type.count)];
  choices.forEach(type=>{
    const button=document.createElement("button");button.type="button";button.className="mobile-archetype-filter";
    button.style.setProperty("--type-color",type.color);
    button.innerHTML=`<i aria-hidden="true"></i><span>${escape(type.label)}</span><small>${type.count}</small>`;
    button.addEventListener("click",()=>{activeType=activeType===type.id?null:type.id;selected=null;input.value="";update();});
    filters.append(button);buttons.push({button,id:type.id});
  });
  const choose = index => {
    selected=selected===index?null:index;
    if(selected!==null && activeType && model.rows[selected].style.id!==activeType)activeType=null;
    input.value="";update();
  };
  chart.addEventListener("click",event=>{
    const target=event.target.closest("[data-archetype-index]");
    if(target){choose(Number(target.dataset.archetypeIndex));return;}
    const box=chart.getBoundingClientRect(),px=(event.clientX-box.left)*320/box.width,py=(event.clientY-box.top)*350/box.height;
    let nearest=null,distance=20;
    model.rows.forEach((row,index)=>{const d=Math.hypot(x(row.type_x)-px,y(row.type_y)-py);if(d<distance){distance=d;nearest=index;}});
    if(nearest!==null)choose(nearest);
  });
  chart.addEventListener("keydown",event=>{
    const target=event.target.closest("[data-archetype-index]");
    if(target && ["Enter"," "].includes(event.key)){event.preventDefault();choose(Number(target.dataset.archetypeIndex));}
  });
  input.addEventListener("input",()=>{
    const query=fold(input.value).trim(), index=query?model.rows.findIndex(row=>fold(row.search_name).includes(query)):-1;
    selected=index<0?null:index;activeType=null;update();
    if(query && index<0)typeDetail.textContent="No matching player in this selection.";
  });
  root.append(search,filters,typeDetail,chart,detail,reading);update();
}
