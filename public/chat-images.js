import {imageStore} from './chat-images-store.js?v=79e44323';
import {IMAGE_LIMITS,IMAGE_RATIOS,dimensionsForRatio,validateImageOptions,imageCapabilities,prepareImageReference,imageBlobData,generatedImage,imageArchiveSnapshot} from './chat-images-core.js?v=19859ff7';

const SUPABASE_URL='https://jgezpvmlnhycxslqbwcx.supabase.co';
const SUPABASE_KEY='sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
const DRIVE_URL=`${SUPABASE_URL}/functions/v1/club-drive`;
const API_URL=`${SUPABASE_URL}/functions/v1/chat`;
const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const t=(key,vars)=>ClubI18n.t(`chatImages.${key}`,vars);
let session=null,epoch=0,models=[],quota=null,records=[],cursor=null,total=0,loading=false;
let run=null,refs=[],currentRecord=null,selecting=false,deleting=false,selectedIds=new Set();
let statusKey='statusReady',statusVars={},statusState='',gateKey='loading';
let archiveQueue=Promise.resolve(),historyRevision=0,resultRevision=0,historyRequest=0,retrying=false;
const liveRecords=new Map(),unsavedRecords=new Map();
const objectUrls={history:new Set(),results:new Set(),references:new Set(),preview:new Set()};
const mobile=window.matchMedia('(max-width:700px)');

function safeText(node,value){if(node)node.textContent=String(value??'');}
function identity(){if(!session?.access_token)throw new Error('login');return {userId:session.user.id,token:session.access_token,epoch};}
function isCurrent(ctx){return ctx.epoch===epoch&&ctx.userId===session?.user?.id;}
function checkIdentity(ctx){if(!isCurrent(ctx))throw new Error('login');}
function authHeaders(ctx){return {apikey:SUPABASE_KEY,authorization:`Bearer ${ctx.token}`};}
function setStatus(key,vars={},state=''){statusKey=key;statusVars=vars;statusState=state;safeText($('imageStatus'),t(key,vars));$('imageStatus').dataset.state=state;}
function resetUrls(group){for(const name of group?[group]:Object.keys(objectUrls)){for(const url of objectUrls[name])URL.revokeObjectURL(url);objectUrls[name].clear();}}
function makeUrl(blob,group){const url=URL.createObjectURL(blob);objectUrls[group].add(url);return url;}
async function readJson(response){
  let value={};try{value=await response.json();}catch{throw Object.assign(new Error('network'),{uncertain:true});}
  if(!response.ok){const error=new Error(String(value?.error||value?.code||'server'));error.status=response.status;error.quota=value?.quota;throw error;}
  return value;
}
async function request(url,options,ctx,{signal,timeout=30000,detached=false}={}){
  if(!detached)checkIdentity(ctx);
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeout);
  try{return await readJson(await fetch(url,{...options,headers:{...authHeaders(ctx),...options.headers},cache:'no-store',signal:controller.signal}));}
  catch(error){if(error?.name==='AbortError'||error?.name==='TimeoutError'||error instanceof TypeError)throw Object.assign(new Error('network'),{uncertain:true});throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function api(action,payload={},ctx=identity(),options={}){return request(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})},ctx,options);}
function driveAction(action,body,headers,ctx){return request(DRIVE_URL,{method:'POST',headers:{'x-drive-action':action,...headers},body},ctx);}
async function cancelBatch(active,detached=false){
  try{const data=await api('image_cancel',{request_id:active.requestId},active.ctx,{detached});if(isCurrent(active.ctx))updateQuota(data.quota);}catch{}
}
function normalizeError(error){
  const code=error?.message;
  if(['global_quota','user_quota'].includes(code))return 'statusQuota';
  if(code==='blacklisted')return 'gateBlacklisted';
  if(['model_unavailable','model','permission'].includes(code))return 'statusNoModels';
  if(code==='profile')return 'gateProfile';
  if(code==='login'||error?.status===401)return 'statusLogin';
  if(['image_invalid','reference_size','reference_invalid','image_result'].includes(code))return 'statusInvalidImage';
  if(code==='archive')return 'archiveFailed';
  if(code==='storage')return 'statusStorage';
  if(code==='quality')return 'statusQuality';
  if(code==='size')return 'statusSize';
  if(code==='background')return 'statusTransparent';
  if(['input','image_options','image_count'].includes(code))return 'statusInput';
  if(error?.uncertain||['network','slot_unavailable','request_conflict','image_upstream_uncertain'].includes(code))return 'statusNetwork';
  return 'statusServer';
}
function dateLabel(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat(ClubI18n.getLang?.()==='en'?'en':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);}
function sizeLabel(size){return size==='auto'?t('resolutionAuto'):String(size||t('unknownSize')).replace('x',' × ');}
function model(){return models.find(item=>item.id===$('imageModel').value)||null;}
function config(){return imageCapabilities(model());}
function updateQuota(data){if(data)quota=data;quotaSummary();}
function quotaSummary(){
  const node=$('imageQuota');node.replaceChildren();if(!quota)return;
  for(const [key,scope] of [['quotaAll',quota.global],['quotaSelf',quota.user]]){
    if(!scope)continue;const label=document.createElement('span');
    const limit=scope.limit==null?t('quotaUnlimited'):`${scope.used||0} / ${scope.limit}`;
    label.textContent=`${t(key)} · ${t('quotaGenerated',{n:scope.generated||0})} · ${t('quotaReserved',{n:scope.reserved||0})} · ${limit}`;node.append(label);
  }
  if(quota.resets_at){const reset=document.createElement('span');reset.textContent=`${t('quotaResets')} · ${dateLabel(quota.resets_at)}`;node.append(reset);}
}
function fillSelect(select,values,selected,format=value=>value){select.replaceChildren(...values.map(value=>new Option(format(value),value)));if(values.includes(selected))select.value=selected;}
function ratioForSize(value){const m=String(value).match(/^(\d+)x(\d+)$/);if(!m)return 'auto';const gcd=(a,b)=>b?gcd(b,a%b):a;const d=gcd(Number(m[1]),Number(m[2]));return `${Number(m[1])/d}:${Number(m[2])/d}`;}
function sizeOptions(cap){
  const values=cap.sizes.filter(value=>value==='auto'||!cap.custom_size&&/^\d+x\d+$/.test(value));
  if(cap.custom_size){for(const edge of [1024,2048,4096])if(edge<=cap.max_dimension)values.push(`r:${edge}`);values.push('custom');}
  return [...new Set(values)];
}
function selectedSize(){
  const cap=config(),value=$('imageResolution').value;
  if(value==='auto')return 'auto';
  if(value.startsWith('r:')){const dims=dimensionsForRatio(Number(value.slice(2)),$('imageRatio').value==='auto'?'1:1':$('imageRatio').value);return `${dims.width}x${dims.height}`;}
  if(value==='custom')return `${Number($('imageWidth').value)}x${Number($('imageHeight').value)}`;
  if(!cap.sizes.includes(value))throw new Error('size');return value;
}
function displayDimensions(size){const parts=String(size).split('x');if(parts.length===2){$('imageWidth').value=parts[0];$('imageHeight').value=parts[1];}}
function updateDimensionsFromControls(){
  const value=$('imageResolution').value;
  try{if(value!=='auto')displayDimensions(selectedSize());}catch{}
  if(!config().custom_size&&value!=='auto')$('imageRatio').value=ratioForSize(value);
}
function changeRatio(){
  const cap=config(),ratio=$('imageRatio').value;
  if(cap.custom_size){
    if($('imageResolution').value==='auto')$('imageResolution').value=sizeOptions(cap).find(value=>value.startsWith('r:'))||'custom';
    if($('imageResolution').value==='custom'&&ratio!=='auto'){
      try{const dims=dimensionsForRatio(Math.max(Number($('imageWidth').value),Number($('imageHeight').value)),ratio);displayDimensions(`${dims.width}x${dims.height}`);}catch{setStatus('statusSize',{},'error');}
    }else updateDimensionsFromControls();
  }else{
    const matching=cap.sizes.filter(size=>ratioForSize(size)===ratio);
    if(matching.length){$('imageResolution').value=matching[0];updateDimensionsFromControls();}
  }
  $('swapDimensions').disabled=$('imageResolution').value==='auto';
}
function swapDimensions(){
  const cap=config();if($('imageResolution').value==='auto')return;
  const swapped=`${$('imageHeight').value}x${$('imageWidth').value}`;
  if(!cap.custom_size&&!cap.sizes.includes(swapped))return setStatus('statusSize',{},'error');
  $('imageResolution').value=cap.custom_size?'custom':swapped;displayDimensions(swapped);
  const ratio=ratioForSize(swapped);$('imageRatio').value=[...$('imageRatio').options].some(option=>option.value===ratio)?ratio:'auto';
}
function refreshModelControls(){
  const item=model();if(!item)return;const cap=config();safeText($('modelDescription'),item.introduction||'');
  fillSelect($('imageQuality'),cap.qualities,$('imageQuality').value,value=>value==='auto'?t('qualityAuto'):value);
  fillSelect($('imageResolution'),sizeOptions(cap),$('imageResolution').value,value=>value==='auto'?t('resolutionAuto'):value==='custom'?t('ratioCustom'):value.startsWith('r:')?`${Number(value.slice(2))/1024}k`:value.replace('x',' × '));
  const ratios=new Set(cap.custom_size?IMAGE_RATIOS:cap.sizes.map(ratioForSize));
  fillSelect($('imageRatio'),IMAGE_RATIOS.filter(value=>ratios.has(value)),$('imageRatio').value,value=>value==='auto'?t('resolutionAuto'):value);
  $('imageWidth').disabled=!cap.custom_size;$('imageHeight').disabled=!cap.custom_size;
  $('imageWidth').max=cap.max_dimension;$('imageHeight').max=cap.max_dimension;
  $('imageRatio').disabled=$('imageRatio').options.length<2;
  $('swapDimensions').disabled=$('imageResolution').value==='auto';
  $('imageTransparent').disabled=!cap.supports_transparency;$('imageTransparent').checked&&=cap.supports_transparency;
  safeText($('transparentHint'),cap.supports_transparency?'':t('statusTransparent'));
  safeText($('referenceHint'),cap.supports_references?'':t('statusReferences'));
  $('imageQuantity').max=cap.max_batch;if(Number($('imageQuantity').value)>cap.max_batch)$('imageQuantity').value=cap.max_batch;
  updateDimensionsFromControls();refreshReferences();
}
function optionsFromForm(){return validateImageOptions({size:selectedSize(),quality:$('imageQuality').value,background:$('imageTransparent').checked?'transparent':'auto'},config());}
function refreshReferences(){
  resetUrls('references');safeText($('referenceCount'),`${refs.length} / ${IMAGE_LIMITS.references}`);const list=$('referenceList');list.replaceChildren();
  for(const id of ['referenceFiles','uploadReferences','pasteReferences'])$(id).disabled=!config().supports_references||refs.length>=IMAGE_LIMITS.references;
  refs.forEach((item,index)=>{
    const wrapper=document.createElement('span');wrapper.className='image-reference';const img=document.createElement('img');img.src=makeUrl(item.blob,'references');img.alt=t('recordReferenceAlt',{index:index+1});
    const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label',t('removeReference',{index:index+1}));remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    remove.onclick=()=>{refs.splice(index,1);refreshReferences();};wrapper.append(img,remove);list.append(wrapper);
  });
}
async function addFiles(files){
  if(!config().supports_references)return setStatus('statusReferences',{},'error');const guard=epoch;
  for(const file of [...files]){
    if(refs.length>=IMAGE_LIMITS.references)break;
    try{const ref=await prepareImageReference(file);if(guard!==epoch)return;if(refs.length<IMAGE_LIMITS.references)refs.push(ref);}
    catch(error){if(guard===epoch)setStatus(normalizeError(error),{},'error');}
  }
  if(guard===epoch)refreshReferences();
}
function setGate(key){gateKey=key;$('imageWorkspace').hidden=true;$('imageGate').hidden=false;refreshGate();}
function refreshGate(){safeText($('gateTitle'),t(gateKey));safeText($('gateMessage'),gateKey==='loading'?'':t(gateKey==='gateNoModels'?'statusNoModels':gateKey));$('imageGate').dataset.retry=String(gateKey==='gateRequest');}
function remember(record){liveRecords.set(record.id,record);return record;}
function updateHistoryRecord(record){
  const index=records.findIndex(item=>item.id===record.id);
  if(index<0){records.unshift(record);total++;}else records[index]=record;
}
async function saveLocal(record){
  record.revision=(record.revision||0)+1;const revision=record.revision;remember(record);
  try{
    const saved=await imageStore.save({...record,localError:false});
    if(record.revision===revision){record.references=saved.references;record.images=saved.images;record.localError=false;unsavedRecords.delete(record.id);}
    return record;
  }catch(error){record.localError=true;unsavedRecords.set(record.id,record);throw Object.assign(new Error('storage'),{cause:error});}
}
async function assetBlob(record,item){return item.blob||await imageStore.getAsset(record.userId,record.id,item.assetId);}
async function uploadAsset(entry,blob,ctx){
  checkIdentity(ctx);if(!blob||blob.size>IMAGE_LIMITS.imageBytes)throw new Error('storage');
  const ext=entry.ext||(entry.mime==='image/jpeg'?'jpg':entry.mime?.split('/')[1]);
  if(!['png','jpg','jpeg','webp'].includes(ext))throw new Error('image_invalid');
  const result=await driveAction('image-attachment',blob,{'x-chat-attachment-hash':entry.sha256,'x-chat-attachment-ext':ext,'x-chat-attachment-type':entry.mime},ctx);
  if(result.ok!==true)throw new Error('archive');checkIdentity(ctx);
}
function archiveRecord(record,ctx=identity()){
  const task=archiveQueue.catch(()=>false).then(async()=>{
    if(!isCurrent(ctx)||record.userId!==ctx.userId)return false;
    const active=liveRecords.get(record.id)||remember(record);
    const revision=active.revision||0;
    const snapshotRecord={...active,references:active.references.map(item=>({...item})),images:active.images.map(item=>({...item}))};
    try{
      for(const entry of [...snapshotRecord.references,...snapshotRecord.images]){
        checkIdentity(ctx);
        if(!entry.archived)await uploadAsset(entry,await assetBlob(active,entry),ctx);
        entry.archived=true;
      }
      checkIdentity(ctx);const result=await driveAction('image-archive',JSON.stringify(imageArchiveSnapshot(snapshotRecord)),{'content-type':'application/json'},ctx);
      if(result.ok!==true)throw new Error('archive');checkIdentity(ctx);
      const hashes=new Set([...snapshotRecord.references,...snapshotRecord.images].map(item=>item.sha256));
      for(const entry of [...active.references,...active.images])if(hashes.has(entry.sha256))entry.archived=true;
      active.archivePending=active.revision!==revision;
      try{await saveLocal(active);}catch{setStatus('statusStorage',{},'error');}
      if(isCurrent(ctx)){updateHistoryRecord(active);void renderHistory();if(currentRecord?.id===active.id){currentRecord=active;renderCurrentRecord();}}
      return !active.archivePending;
    }catch{
      if(!isCurrent(ctx))return false;
      active.archivePending=true;try{await saveLocal(active);}catch{}
      updateHistoryRecord(active);void renderHistory();if(currentRecord?.id===active.id){currentRecord=active;renderCurrentRecord();}return false;
    }
  });archiveQueue=task;return task;
}
async function retryPending(guard=epoch){
  if(!session||retrying)return;retrying=true;const ctx=identity();$('retryArchives').disabled=true;
  try{
    const pending=await imageStore.pending(ctx.userId,{limit:20});
    for(const record of unsavedRecords.values())if(record.userId===ctx.userId&&!pending.some(item=>item.id===record.id))pending.push(record);
    let count=0;for(const record of pending){if(guard!==epoch)break;if(run?.recordId===record.id)continue;if(await archiveRecord(liveRecords.get(record.id)||record,ctx))count++;}
    if(isCurrent(ctx)&&count)setStatus('statusArchiveRetried',{count},'ok');
  }catch{if(isCurrent(ctx))setStatus('statusStorage',{},'error');}
  finally{if(isCurrent(ctx)){$('retryArchives').disabled=false;retrying=false;}}
}
async function loadCatalog(guard=epoch){
  setGate('loading');const ctx=identity();
  try{
    const data=await api('image_catalog',{},ctx);if(guard!==epoch)return;
    models=Array.isArray(data.models)?data.models.filter(item=>item?.id&&item?.image_config):[];updateQuota(data.quota);
    if(!models.length)return setGate('gateNoModels');
    $('imageModel').replaceChildren(...models.map(item=>new Option(item.display_name,item.id)));
    safeText($('imageAccount'),data.member_name||session.user.email||'');$('imageWorkspace').hidden=false;$('imageGate').hidden=true;
    refreshModelControls();setStatus('statusReady');syncRunControls();await loadHistory(true,guard);void retryPending(guard);
  }catch(error){if(guard===epoch)setGate(error?.message==='profile'?'gateProfile':error?.message==='blacklisted'?'gateBlacklisted':error?.message==='login'||error?.status===401?'gateLogin':'gateRequest');}
}
async function auth(next){
  if(next&&session?.user?.id===next.user.id){session=next;return;}
  const previous=run;if(previous){previous.stopped=true;previous.controller.abort();void cancelBatch(previous,true);}
  const guard=++epoch;run=null;session=next;quota=null;models=[];currentRecord=null;refs=[];records=[];cursor=null;total=0;loading=false;retrying=false;deleting=false;selecting=false;
  selectedIds.clear();liveRecords.clear();unsavedRecords.clear();historyRevision++;resultRevision++;historyRequest++;closePreview();closeHistory(false);resetUrls();
  $('imagePrompt').value='';$('promptLength').textContent=`0 / ${IMAGE_LIMITS.prompt}`;$('retryArchives').disabled=false;syncRunControls();
  if(!next){setGate('gateLogin');return;}await loadCatalog(guard);
}
async function loadHistory(reset=false,guard=epoch){
  if(!session||loading)return;loading=true;const requestId=++historyRequest,ctx=identity();
  try{
    const page=await imageStore.list(ctx.userId,{before:reset?null:cursor,limit:30});if(guard!==epoch||requestId!==historyRequest)return;
    const loaded=[];
    for(const item of page.records){
      const record=liveRecords.get(item.id)||remember(item);
      if(record.status==='running'&&run?.recordId!==record.id){
        record.status='uncertain';record.finishedAt=Date.now();record.archivePending=true;
        record.slots=(record.slots||[]).map(slot=>({...slot,status:slot.status==='running'?'uncertain':slot.status==='queued'?'cancelled':slot.status}));
        try{await saveLocal(record);}catch{}await cancelBatch({requestId:record.id,ctx});
      }
      loaded.push(record);
    }
    if(guard!==epoch)return;records=reset?loaded:[...records,...loaded.filter(item=>!records.some(value=>value.id===item.id))];cursor=page.nextCursor;total=page.total;
    for(const record of unsavedRecords.values())if(record.userId===ctx.userId&&!records.some(item=>item.id===record.id)){records.unshift(record);total++;}
    void renderHistory();if(reset&&!currentRecord&&records.length)await showRecord(records[0].id,guard);else if(reset&&!records.length)showEmpty();
  }catch{if(guard===epoch)setStatus('statusStorage',{},'error');}
  finally{if(guard===epoch&&requestId===historyRequest)loading=false;}
}
async function renderHistory(){
  const revision=++historyRevision,guard=epoch;resetUrls('history');const list=$('imageRecords');list.replaceChildren();safeText($('recordCount'),total);
  $('historyEmpty').hidden=records.length>0;$('moreRecords').hidden=!cursor;$('selectRecords').hidden=records.length===0;$('selectAll').hidden=!selecting;$('deleteRecords').hidden=!selecting;
  $('selectRecords').textContent=t(selecting?'doneSelecting':'select');$('selectRecords').setAttribute('aria-pressed',String(selecting));
  for(const item of records){
    const li=document.createElement('li');li.className='image-record-item';
    if(selecting){const box=document.createElement('input');box.type='checkbox';box.className='image-select-box';box.checked=selectedIds.has(item.id);box.setAttribute('aria-label',`${t('imageRecord')} · ${item.prompt}`);box.onchange=()=>{box.checked?selectedIds.add(item.id):selectedIds.delete(item.id);updateSelection();};li.append(box);}
    const button=document.createElement('button');button.type='button';button.className='image-record';button.setAttribute('aria-current',String(currentRecord?.id===item.id));
    button.onclick=()=>{if(selecting){selectedIds.has(item.id)?selectedIds.delete(item.id):selectedIds.add(item.id);updateSelection();void renderHistory();}else void showRecord(item.id);};
    const placeholder=document.createElement('span');placeholder.className='image-record-placeholder';placeholder.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 5 5 3-3 5 5"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>';button.append(placeholder);
    const copy=document.createElement('span');copy.className='image-record-copy';const title=document.createElement('strong');title.textContent=item.prompt||t('imageRecord');
    const meta=document.createElement('small');meta.textContent=`${item.modelName||''} · ${dateLabel(item.createdAt)}`;const flag=document.createElement('small');flag.className='image-record-flag';flag.dataset.state=item.archivePending?'pending':'done';flag.textContent=t(item.localError?'statusLocalUnsaved':item.archivePending?'archivePending':'archived');copy.append(title,meta,flag);button.append(copy);li.append(button);list.append(li);
    const image=item.images?.[0];if(image)void assetBlob(item,image).then(blob=>{if(!blob||revision!==historyRevision||guard!==epoch)return;const img=document.createElement('img');img.src=makeUrl(blob,'history');img.alt=t('recordImageAlt',{index:1});placeholder.replaceWith(img);}).catch(()=>{});
  }
}
function updateSelection(){setStatus('statusSelected',{count:selectedIds.size});}
function showEmpty(){resultRevision++;resetUrls('results');currentRecord=null;$('resultsEmpty').hidden=false;$('resultSummary').hidden=true;$('resultGrid').replaceChildren();$('resultProgress').hidden=true;safeText($('resultCount'),'');}
async function showRecord(id,guard=epoch){
  if(!session||guard!==epoch)return;
  try{const record=liveRecords.get(id)||await imageStore.get(session.user.id,id);if(guard!==epoch||!record)return;currentRecord=remember(record);void renderHistory();renderCurrentRecord();if(mobile.matches)closeHistory();}
  catch{if(guard===epoch)setStatus('statusStorage',{},'error');}
}
function renderProgress(){const active=run&&currentRecord?.id===run.recordId;$('resultProgress').hidden=!active;if(active)safeText($('progressTitle'),t(run.progressKey||'progressPreparing',run.progressVars||{}));}
function renderCurrentRecord(){
  const record=currentRecord;if(!record)return showEmpty();const revision=++resultRevision,guard=epoch;resetUrls('results');
  $('resultsEmpty').hidden=true;$('resultSummary').hidden=false;renderProgress();safeText($('resultPrompt'),record.prompt);
  safeText($('resultMeta'),t('metadata',{model:record.modelName||'',size:sizeLabel(record.options?.size),date:dateLabel(record.createdAt)}));
  $('archiveStatus').dataset.state=record.localError||record.archivePending?'error':'ok';safeText($('archiveStatus'),t(record.localError?'statusLocalUnsaved':record.archivePending?'archivePending':'archived'));
  const grid=$('resultGrid');grid.replaceChildren();safeText($('resultCount'),t('resultCount',{count:record.images.length}));
  for(const [index,image] of record.images.entries()){
    const card=document.createElement('article');card.className='image-card';grid.append(card);
    void assetBlob(record,image).then(blob=>{
      if(!blob||revision!==resultRevision||guard!==epoch)return;
      const preview=document.createElement('button');preview.type='button';preview.className='image-card-preview';preview.setAttribute('aria-label',t('recordImageAlt',{index:index+1}));
      const img=document.createElement('img');img.src=makeUrl(blob,'results');img.alt=t('recordImageAlt',{index:index+1});preview.append(img);preview.onclick=()=>openPreview(blob,record,image);
      const footer=document.createElement('div');footer.className='image-card-foot';const dimensions=document.createElement('span');dimensions.textContent=`${image.width} × ${image.height}`;const state=document.createElement('span');state.textContent=t(image.archived?'archived':'archivePending');footer.append(dimensions,state);
      const download=document.createElement('a');download.className='image-card-download';download.href=img.src;download.download=`image-${record.id}-${image.slot+1}.${image.ext}`;download.setAttribute('aria-label',t('download'));download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';card.append(preview,download,footer);
    }).catch(()=>{if(revision===resultRevision&&guard===epoch)setStatus('statusStorage',{},'error');});
  }
  for(const slot of record.slots||[]){if(!['failed','uncertain'].includes(slot.status))continue;const note=document.createElement('p');note.className='image-slot-note';note.textContent=t(slot.status==='uncertain'?'uncertainSlot':'failedSlot',{slot:slot.slot+1});grid.append(note);}
}
function openPreview(blob,record,image){resetUrls('preview');const src=makeUrl(blob,'preview');$('previewImage').src=src;$('previewImage').alt=record.prompt;$('previewImage').removeAttribute('hidden');$('previewDownload').href=src;$('previewDownload').download=`image-${record.id}-${image.slot+1}.${image.ext}`;safeText($('previewMeta'),`${image.width} × ${image.height} · ${image.bytes} bytes`);$('imagePreview').showModal();}
function closePreview(){if($('imagePreview').open)$('imagePreview').close();$('previewImage').removeAttribute('src');$('previewImage').setAttribute('hidden','');$('previewDownload').removeAttribute('href');resetUrls('preview');}
function syncRunControls(){const busy=Boolean(run);$('generateImage').disabled=busy||deleting;$('stopImage').hidden=!busy;$('stopImage').disabled=Boolean(run?.stopped);$('newImage').disabled=busy;$('reuseRecord').disabled=busy;$('deleteRecords').disabled=busy||deleting;renderProgress();}
function setProgress(active,key,vars={}){active.progressKey=key;active.progressVars=vars;if(isCurrent(active.ctx))renderProgress();}
async function persistResult(record){try{await saveLocal(record);return true;}catch{setStatus('statusStorage',{},'error');return false;}}
async function startGeneration(event){
  event?.preventDefault();if(run||deleting||!session)return;
  const item=model(),prompt=$('imagePrompt').value.trim();if(!item)return setStatus('statusNoModels',{},'error');
  if(!prompt)return setStatus('statusPromptRequired',{},'error');if(prompt.length>IMAGE_LIMITS.prompt)return setStatus('statusPromptTooLong',{},'error');
  const cap=config(),count=Number($('imageQuantity').value);if(!Number.isSafeInteger(count)||count<1||count>cap.max_batch)return setStatus('statusCount',{max:cap.max_batch},'error');
  if(refs.length&&!cap.supports_references)return setStatus('statusReferences',{},'error');let options;try{options=optionsFromForm();}catch(error){return setStatus(normalizeError(error),{},'error');}
  const active={ctx:identity(),requestId:crypto.randomUUID(),controller:new AbortController(),stopped:false,attempted:false};active.recordId=active.requestId;run=active;syncRunControls();
  const record=remember({id:active.requestId,userId:active.ctx.userId,prompt,modelId:item.id,modelName:item.display_name,options,count,createdAt:Date.now(),finishedAt:null,references:refs.map((value,index)=>({...value,assetId:`reference-${index}`})),images:[],slots:Array.from({length:count},(_,slot)=>({slot,status:'queued'})),status:'running',archivePending:true});
  let errorKey='',unknown=false;
  try{
    if(!await persistResult(record)){liveRecords.delete(record.id);unsavedRecords.delete(record.id);return;}
    updateHistoryRecord(record);currentRecord=record;renderCurrentRecord();void renderHistory();setProgress(active,'progressPreparing');
    const referencePayload=await Promise.all(record.references.map(async entry=>({name:entry.name,data:await imageBlobData(await assetBlob(record,entry))})));
    checkIdentity(active.ctx);if(active.stopped)return;
    active.attempted=true;const begun=await api('image_begin',{request_id:record.id,model_id:item.id,prompt,options,references:referencePayload,count},active.ctx);
    checkIdentity(active.ctx);updateQuota(begun.quota);if(begun.allowed!==true)throw new Error(begun.code||'server');
    await archiveRecord(record,active.ctx);
    for(let slot=0;slot<count&&!active.stopped;slot++){
      checkIdentity(active.ctx);setProgress(active,'progressBatch',{current:slot+1,total:count,done:record.images.length});
      record.slots[slot].status='running';record.archivePending=true;if(!await persistResult(record)){record.slots[slot].status='cancelled';errorKey='statusStorage';break;}
      try{
        const response=await api('image_generate',{request_id:record.id,slot,model_id:item.id,prompt,options,references:referencePayload},active.ctx,{signal:active.controller.signal,timeout:125000});
        checkIdentity(active.ctx);updateQuota(response.quota);
        const image={...await generatedImage(response.image),slot,assetId:`image-${slot}`,archived:response.archive?.ok===true};checkIdentity(active.ctx);
        record.images.push(image);if(response.archive?.ok===true)for(const ref of record.references)ref.archived=true;
        const uncertain=response.status==='uncertain';record.slots[slot]={slot,status:uncertain?'uncertain':'succeeded'};record.archivePending=true;
        await persistResult(record);renderCurrentRecord();void renderHistory();await archiveRecord(record,active.ctx);
        if(uncertain){unknown=true;break;}
      }catch(error){
        if(!isCurrent(active.ctx))return;if(error.quota)updateQuota(error.quota);
        const knownRejection=error.status>=400&&error.status<500&&!['slot_unavailable','request_conflict'].includes(error.message);
        unknown=!knownRejection;record.slots[slot]={slot,status:unknown?'uncertain':'failed',errorCode:unknown?'uncertain':error.message};errorKey=normalizeError(error);break;
      }
    }
  }catch(error){if(isCurrent(active.ctx)){if(error.quota)updateQuota(error.quota);errorKey=normalizeError(error);}}
  finally{
    if(active.attempted)await cancelBatch(active,!isCurrent(active.ctx));
    if(isCurrent(active.ctx)&&run===active){
      for(const slot of record.slots)if(slot.status==='queued')slot.status='cancelled';
      record.finishedAt=Date.now();record.status=unknown?'uncertain':record.images.length===count?'completed':active.stopped?'cancelled':record.images.length?'partial':'failed';record.archivePending=true;
      if(liveRecords.has(record.id)){await persistResult(record);updateHistoryRecord(record);await archiveRecord(record,active.ctx);}
      if(isCurrent(active.ctx)&&run===active){
        run=null;syncRunControls();renderCurrentRecord();void renderHistory();
        if(record.localError)setStatus('statusStorage',{},'error');
        else if(record.status==='completed')setStatus('statusComplete',{count:record.images.length},'ok');
        else if(unknown)setStatus('statusPartial',{done:record.images.length,total:count},'error');
        else if(errorKey)setStatus(errorKey,{},'error');
        else setStatus('statusStopped');
      }
    }
  }
}
function stopGeneration(){if(!run)return;run.stopped=true;run.controller.abort();syncRunControls();setStatus('statusStopping');void cancelBatch(run);}
async function showSelectedRecord(id){
  if(run)return;const ctx=identity();const record=liveRecords.get(id)||await imageStore.get(ctx.userId,id);if(!record||!isCurrent(ctx))return;
  const item=models.find(value=>value.id===record.modelId);if(!item)return setStatus('statusReuseModel',{},'error');
  const cap=imageCapabilities(item);let options;
  try{options=validateImageOptions(record.options,cap);}catch(error){return setStatus(normalizeError(error),{},'error');}
  if(record.references.length&&!cap.supports_references)return setStatus('statusReferences',{},'error');
  const restored=[];try{for(const ref of record.references){const blob=await assetBlob(record,ref);checkIdentity(ctx);if(!blob)throw new Error('storage');restored.push({...ref,blob});}}catch{return setStatus('statusStorage',{},'error');}
  if(!isCurrent(ctx))return;
  currentRecord=remember(record);$('imageModel').value=item.id;refreshModelControls();$('imagePrompt').value=record.prompt||'';safeText($('promptLength'),`${$('imagePrompt').value.length} / ${IMAGE_LIMITS.prompt}`);
  $('imageQuality').value=options.quality;$('imageTransparent').checked=options.background==='transparent';$('imageQuantity').value=Math.min(cap.max_batch,record.count||1);
  const size=options.size,sizes=sizeOptions(cap);$('imageResolution').value=sizes.includes(size)?size:'custom';
  displayDimensions(size);const ratio=ratioForSize(size);$('imageRatio').value=[...$('imageRatio').options].some(option=>option.value===ratio)?ratio:'auto';
  refs=restored;refreshReferences();updateDimensionsFromControls();$('swapDimensions').disabled=size==='auto';renderCurrentRecord();void renderHistory();setStatus('statusReused');
}
function resetForNew(){if(run)return;currentRecord=null;refs=[];$('imagePrompt').value='';$('imageQuantity').value='1';$('imageTransparent').checked=false;refreshModelControls();safeText($('promptLength'),`0 / ${IMAGE_LIMITS.prompt}`);showEmpty();void renderHistory();setStatus('statusReady');closeHistory(false);$('imagePrompt').focus();}
async function deleteSelected(){
  if(run||deleting)return;const ids=[...selectedIds];if(!ids.length)return setStatus('statusNoSelection',{},'error');const ctx=identity();
  if(!(await ClubCommon.confirm({message:t('statusConfirmDelete',{count:ids.length}),danger:true}))||!isCurrent(ctx))return;
  deleting=true;syncRunControls();
  try{
    for(const id of ids){checkIdentity(ctx);const record=liveRecords.get(id)||await imageStore.get(ctx.userId,id);if(!record||!await archiveRecord(record,ctx))throw new Error('archive');}
    checkIdentity(ctx);await imageStore.deleteMany(ctx.userId,ids);checkIdentity(ctx);
    for(const id of ids){liveRecords.delete(id);unsavedRecords.delete(id);}selectedIds.clear();selecting=false;
    if(ids.includes(currentRecord?.id))showEmpty();await loadHistory(true,ctx.epoch);setStatus('statusDeleted',{count:ids.length},'ok');
  }catch(error){if(isCurrent(ctx))setStatus(error.message==='archive'?'statusDeleteArchive':'statusDeleteFailed',{},'error');}
  finally{if(isCurrent(ctx)){deleting=false;syncRunControls();}}
}
function setHistoryInert(open){
  $('imageSidebar').inert=mobile.matches&&!open;
  for(const node of document.querySelectorAll('.image-settings,.image-results,.image-topbar'))node.inert=mobile.matches&&open;
}
function openHistory(){if(!mobile.matches)return;document.body.classList.add('history-open');$('historyBackdrop').hidden=false;$('historyToggle').setAttribute('aria-expanded','true');setHistoryInert(true);$('historyClose').focus();}
function closeHistory(focus=true){const wasOpen=document.body.classList.contains('history-open');document.body.classList.remove('history-open');$('historyBackdrop').hidden=true;$('historyToggle').setAttribute('aria-expanded','false');setHistoryInert(false);if(focus&&wasOpen)$('historyToggle').focus();}
function refreshLocalized(){for(const node of document.querySelectorAll('[data-lang-option]'))node.classList.toggle('is-active',node.dataset.langOption===ClubI18n.getLang());refreshGate();if(model())refreshModelControls();quotaSummary();setStatus(statusKey,statusVars,statusState);void renderHistory();if(currentRecord)renderCurrentRecord();}
async function refreshQuota(){if(!session||document.hidden)return;const ctx=identity();try{const data=await api('image_catalog',{},ctx);if(isCurrent(ctx))updateQuota(data.quota);}catch{}}

$('imageModel').addEventListener('change',refreshModelControls);
$('imageResolution').addEventListener('change',()=>{updateDimensionsFromControls();$('swapDimensions').disabled=$('imageResolution').value==='auto';});
$('imageRatio').addEventListener('change',changeRatio);
for(const id of ['imageWidth','imageHeight'])$(id).addEventListener('input',()=>{if(config().custom_size){$('imageResolution').value='custom';$('imageRatio').value='auto';$('swapDimensions').disabled=false;}});
$('swapDimensions').onclick=swapDimensions;
$('imageQuantity').addEventListener('change',()=>{const value=Number($('imageQuantity').value);$('imageQuantity').value=String(Number.isSafeInteger(value)?Math.max(1,Math.min(config().max_batch,value)):1);});
$('imagePrompt').addEventListener('input',()=>safeText($('promptLength'),`${$('imagePrompt').value.length} / ${IMAGE_LIMITS.prompt}`));
$('imageForm').addEventListener('submit',event=>void startGeneration(event));$('stopImage').onclick=stopGeneration;$('newImage').onclick=resetForNew;
$('uploadReferences').onclick=()=>$('referenceFiles').click();$('referenceFiles').addEventListener('change',event=>{void addFiles(event.target.files||[]);event.target.value='';});
$('pasteReferences').onclick=async()=>{try{const items=await navigator.clipboard.read(),files=[];for(const item of items)for(const type of item.types)if(type.startsWith('image/'))files.push(new File([await item.getType(type)],`clipboard-${files.length+1}.${type.split('/')[1]}`,{type}));if(files.length)await addFiles(files);else setStatus('statusNoClipboard',{},'error');}catch{setStatus('statusClipboardDenied',{},'error');}};
$('referenceDrop').addEventListener('dragover',event=>{event.preventDefault();$('referenceDrop').classList.add('is-over');});$('referenceDrop').addEventListener('dragleave',()=>$('referenceDrop').classList.remove('is-over'));
$('referenceDrop').addEventListener('drop',event=>{event.preventDefault();$('referenceDrop').classList.remove('is-over');void addFiles(event.dataTransfer?.files||[]);});
document.addEventListener('paste',event=>{if(!event.clipboardData||!config().supports_references)return;const files=[...event.clipboardData.items].filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();void addFiles(files);}});
$('selectRecords').onclick=()=>{selecting=!selecting;selectedIds.clear();void renderHistory();};$('selectAll').onclick=()=>{for(const item of records)selectedIds.add(item.id);updateSelection();void renderHistory();};$('deleteRecords').onclick=()=>void deleteSelected();$('moreRecords').onclick=()=>void loadHistory(false);
$('historyToggle').onclick=openHistory;$('historyClose').onclick=()=>closeHistory();$('historyBackdrop').onclick=()=>closeHistory();mobile.addEventListener('change',()=>closeHistory(false));setHistoryInert(false);
document.addEventListener('keydown',event=>{
  if(!document.body.classList.contains('history-open'))return;
  if(event.key==='Escape'){event.preventDefault();closeHistory();}
  if(event.key==='Tab'){const focusable=[...$('imageSidebar').querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(node=>!node.hidden&&node.getClientRects().length);const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
$('retryArchives').onclick=()=>void retryPending();$('gateRetry').onclick=()=>{if(session)void loadCatalog(epoch);};
$('copyPrompt').onclick=async()=>{try{await navigator.clipboard.writeText(currentRecord?.prompt||'');setStatus('statusCopied',{},'ok');}catch{setStatus('statusCopyFailed',{},'error');}};$('reuseRecord').onclick=()=>{if(currentRecord)void showSelectedRecord(currentRecord.id);};
$('previewClose').onclick=closePreview;$('imagePreview').addEventListener('cancel',event=>{event.preventDefault();closePreview();});$('imagePreview').addEventListener('close',closePreview);$('imagePreview').addEventListener('click',event=>{if(event.target===$('imagePreview'))closePreview();});
$('language').onclick=()=>ClubI18n.setLang(ClubI18n.getLang()==='zh'?'en':'zh');$('themeToggle').onclick=()=>ClubTheme.setMode(ClubTheme.getTheme()==='light'?'dark':'light',{persist:true,syncRemote:true});
window.addEventListener('club:langchange',refreshLocalized);setTimeout(refreshLocalized,0);
window.addEventListener('pagehide',()=>{if(run)stopGeneration();closePreview();resetUrls();});
window.addEventListener('pageshow',()=>{refreshReferences();void renderHistory();if(currentRecord)renderCurrentRecord();void refreshQuota();});
window.addEventListener('focus',()=>void refreshQuota());window.addEventListener('online',()=>{void refreshQuota();void retryPending();});
let authEvents=0;const initial=authEvents;client.auth.onAuthStateChange((_event,next)=>{authEvents++;setTimeout(()=>void auth(next),0);});
client.auth.getSession().then(({data,error})=>{if(authEvents===initial)void auth(error?null:data.session);}).catch(()=>{if(authEvents===initial)void auth(null);});
