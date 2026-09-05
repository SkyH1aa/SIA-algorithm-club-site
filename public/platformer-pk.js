(function(){
  'use strict';
  const $=id=>document.getElementById(id),panel=$('pk-panel'),open=$('pk-open-button');
  if(!panel||!open||!window.Phaser)return;
  const combat=window.xingyuPlatformerCombat;
  const status=$('pk-status'),room=$('pk-room'),code=$('pk-room-code'),roomState=$('pk-room-state'),presence=$('pk-room-presence'),mineReady=$('pk-my-ready'),peerReady=$('pk-peer-ready'),message=$('pk-room-message'),arena=$('pk-arena'),hostHud=$('pk-self-hud'),peerHud=$('pk-peer-hud'),matchHud=$('pk-match-hud');
  const WORLD_W=1500,VIEW_W=1280,VIEW_H=720,NET_MS=50;
  const state={room:null,channel:null,poll:0,role:'host',match:null,peer:null,scene:null,peerState:null,peerSeq:-1,stateSeq:0,pendingShots:[],pendingSkills:[],pendingHits:[],finished:false,ready:false};
  const db=()=>window.xingyuPlatformerDb,session=()=>window.xingyuGetSession?.();
  const say=(text,error)=>{status.textContent=text;status.style.color=error?'#ff8794':'#ffd166'};
  const roomSay=(text,error)=>{message.textContent=text;message.style.color=error?'#ff8794':'#ffd166'};
  const send=(event,payload)=>{try{const result=state.channel?.send({type:'broadcast',event,payload});if(result&&typeof result.catch==='function')result.catch(()=>{});}catch(_){} };
  async function rpc(name,args){const client=db(),user=session();if(!client||!user)throw Error('请先登录游戏');try{const result=await client.functions.invoke('platformer-pk',{body:{action:name,username:user.username,token:user.token,args}});if(!result.error)return result.data?.data??result.data}catch(_){}const result=await client.rpc(name,{p_username:user.username,p_token:user.token,...args});if(result.error)throw result.error;return Array.isArray(result.data)?result.data[0]:result.data;}
  function clearRoom(){try{state.channel?.unsubscribe()}catch(_){}clearInterval(state.poll);state.channel=null;if(state.scene?.game)state.scene.game.destroy(true);state.scene=null;state.room=null;state.match=null;state.peerState=null;state.peerSeq=-1;state.stateSeq=0;state.pendingShots=[];state.pendingSkills=[];state.pendingHits=[];state.finished=false;$('pk-ready-button')?.removeAttribute('disabled');arena.classList.add('pk-hidden');room.classList.add('pk-hidden');}
  function updateRoom(snapshot){
    if(!snapshot)return;room.classList.remove('pk-hidden');code.textContent=snapshot.invite_code||state.room?.invite_code||'--------';roomState.textContent=snapshot.status==='started'?'对战进行中':snapshot.status==='finished'?'对战结束':snapshot.status==='disputed'?'结果争议/已退款':snapshot.status==='cancelled'?'房间已取消':snapshot.status==='paired'?'已匹配对手':'等待对手';
    const members=snapshot.members||[],me=members.find(member=>member.username===session()?.username),other=members.find(member=>member.username!==session()?.username);state.peer=other||state.peer;state.ready=!!me?.ready;mineReady.textContent=state.ready?'已准备':'未准备';peerReady.textContent=other?.ready?'已准备':'未准备';presence.textContent=`${Math.min(2,members.length)} / 2`;
    if(snapshot.status==='started'&&snapshot.match_id&&!state.match){state.match={id:snapshot.match_id};startArena();}
    if(snapshot.status==='finished'||snapshot.status==='disputed'||snapshot.status==='cancelled'){
      const winner=snapshot.winner_username;
      if(state.scene&&!state.scene.ended)state.scene.finish(winner===session()?.username,true);
      roomSay(snapshot.status==='finished'?(winner===session()?.username?'你已获胜，押注已结算。':'你已失败，押注已结算。'):'本局已结束，未进行对战结算。',winner!==session()?.username);
      if(snapshot.status!=='started'){$('pk-ready-button')?.setAttribute('disabled','disabled');$('pk-leave-button')?.removeAttribute('disabled');}
      else {$('pk-ready-button')?.removeAttribute('disabled');$('pk-leave-button')?.removeAttribute('disabled');}
    }
  }
  async function loadRoom(){try{if(state.room)updateRoom(await rpc('platformer_pk_room_snapshot',{p_room_id:state.room.id}))}catch(error){roomSay(error.message||'读取房间失败',true)}}
  function mergePeer(packet){
    if(!packet)return;
    const seq=Number(packet.seq);
    // Broadcast delivery is not ordered. Never let a delayed position packet
    // pull the remote player back to an older location.
    if(Number.isFinite(seq)&&seq<=state.peerSeq)return;
    if(Number.isFinite(seq))state.peerSeq=seq;
    state.peerState={...(state.peerState||{}),...packet,receivedAt:performance.now()};
  }
  async function connect(){
    const client=db(),user=session();state.channel=client.channel(`pk-room:${state.room.id}`,{config:{broadcast:{self:false},presence:{key:user.username}}});
    state.channel.on('broadcast',{event:'room'},loadRoom).on('broadcast',{event:'state'},event=>mergePeer(event.payload||{})).on('broadcast',{event:'shot'},event=>{const payload=event.payload||{};if(state.scene?.pvpReady)state.scene.remoteShot(payload);else state.pendingShots.push(payload)}).on('broadcast',{event:'skill'},event=>{const payload=event.payload||{};if(state.scene?.pvpReady)state.scene.remoteSkill(payload);else state.pendingSkills.push(payload)}).on('broadcast',{event:'hit'},event=>{const payload=event.payload||{};if(state.scene?.pvpReady)state.scene.receivePvpHit(payload);else state.pendingHits.push(payload)}).on('broadcast',{event:'result'},event=>{if(!state.finished)state.scene?.finish(event.payload?.winner===state.role,true);void loadRoom()}).on('presence',{event:'sync'},()=>presence.textContent=`${Math.min(2,Object.keys(state.channel.presenceState()).length)} / 2`);
    await new Promise((resolve,reject)=>state.channel.subscribe(async value=>{if(value!=='SUBSCRIBED')return reject(Error(`实时连接失败：${value}`));await state.channel.track({username:user.username});resolve();}));state.poll=setInterval(loadRoom,5000);await loadRoom();
  }
  async function createRoom(){try{state.room=await rpc('platformer_pk_create_room',{});state.role='host';say('房间已创建，把邀请码发给对手。');await connect()}catch(error){say(error.message||'创建房间失败',true)}}
  async function join(){const invite=$('pk-code-input').value.trim().toUpperCase();if(!invite)return say('请输入邀请码',true);try{state.room=await rpc('platformer_pk_join_room',{p_invite_code:invite});state.role='guest';say('已加入房间。');await connect()}catch(error){say(error.message||'加入房间失败',true)}}
  async function accept(){try{await rpc('platformer_pk_accept_invite',{p_room_id:state.room.id});send('room',{});await loadRoom()}catch(error){roomSay(error.message||'接受邀请失败',true)}}
  async function wager(){const amount=Math.floor(Number($('pk-wager-input').value)||0);if(amount<0||amount>1000000)return roomSay('押注范围为 0-1000000 金币。',true);try{await rpc('platformer_pk_lock_wager',{p_room_id:state.room.id,p_amount:amount});send('room',{});await loadRoom()}catch(error){roomSay(error.message||'锁定押注失败',true)}}
  async function ready(){try{await rpc('platformer_pk_set_ready',{p_room_id:state.room.id,p_ready:!state.ready});send('room',{});await loadRoom()}catch(error){roomSay(error.message||'准备失败',true)}}
  async function leave(){try{
    if(state.scene&&!state.scene.ended){state.scene.finish(false);roomSay('已提交退出结果，正在结束对局。');return;}
    await rpc('platformer_pk_leave_room',{p_room_id:state.room.id});clearRoom();say('已退出 PK 房间。');
  }catch(error){roomSay(error.message||'退出失败',true)}}

  class PkArenaScene extends combat.Game{
    constructor(){super('PkArenaScene');}
    preload(){const base=new URL('GamePictures/',document.baseURI);Object.entries(combat.ART).forEach(([key,file])=>this.load.image(key,new URL(file,base).href));}
    create(){try{combat.prepareTextures(this);combat.createArenaWorld(this);this.configurePvp();}catch(error){roomSay(`竞技场启动失败：${error.message||error}`,true);console.error('[行于无垠 PK]',error);}}
    configurePvp(){
      this.pvp=true;this.pvpReady=false;this.resultSubmitted=false;this.lastNetAt=0;this.hitSeq=0;this.shotSeq=0;this.outgoingShots=[];this.hitLog=[];this.appliedStateHitIds=new Set();this.receivedHitIds=new Set();this.remoteShotIds=new Set();this.enemyMultiplier=1;this.bossEnemy=null;this.finishZone?.destroy();this.flag?.destroy();this.finishZone=null;this.flag=null;
      this.player.setPosition(state.role==='host'?190:WORLD_W-190,this.floorTop-this.player.body.height/2-2);this.player.body.reset(this.player.x,this.player.y);
      const peer=state.peerState||{},spawnX=state.role==='host'?WORLD_W-190:190;
      // The remote player uses the exact same invisible physics body as the
      // local player. Rendering is separate, so source image proportions can
      // never distort the collision box or make bullets miss the artwork.
      this.rival=this.physics.add.sprite(Number(peer.x)||spawnX,this.floorTop-this.player.body.height/2-2,'hitPlayer').setVisible(false).setImmovable(true);
      this.enemies.add(this.rival,true);this.rival.setActive(true).setVisible(false);this.rival.body.enable=true;this.rival.body.setAllowGravity(false).setSize(this.player.body.width,this.player.body.height).setOffset(0,0);this.rival.hp=Number(peer.hp)||this.maxHp;this.rival.maxHp=Number(peer.maxHp)||this.maxHp;this.rival.shield=0;this.rival.maxShield=0;this.rival.flying=false;this.rival.boss=false;this.rival.elite=false;this.rival.stunnedUntil=0;this.rival.artSize=[52,78];
      this.rivalArt=this.add.image(this.rival.x,this.floorTop,'heroStandL').setOrigin(.5,1).setDisplaySize(52,78).setDepth(4);this.rivalWeapon=this.add.image(this.rival.x,this.floorTop-48,'weaponPistol').setOrigin(.12,.5).setDisplaySize(46,31).setDepth(5);this.rivalLaser=this.add.graphics().setDepth(7);window.xingyuPkActiveScene=this;
      // Register the dynamic rival directly as an overlap target. Phaser can
      // otherwise miss a body added to an already-created Group on some
      // versions/builds, which made every projectile appear harmless.
      this.physics.add.overlap(this.playerBullets,this.rival,this.hitRivalBullet,null,this);
      this.pvpReady=true;
      state.pendingShots.splice(0).forEach(packet=>this.remoteShot(packet));
      state.pendingSkills.splice(0).forEach(packet=>this.remoteSkill(packet));
      state.pendingHits.splice(0).forEach(packet=>this.receivePvpHit(packet));
      roomSay('竞技场已就绪：单机同款武器、跳跃、近战、护甲、闪身和大招均已启用。');
    }
    updateEnemies(){this.syncRival();}
    touchEnemy(){}
    // Remote projectiles are a visual replay only. Their actual hit was
    // resolved by the firing client's normal Game.hitEnemy() path and arrives
    // through the deduplicated `hit` event below.
    hitPlayer(player,bullet){bullet?.destroy();}
    hitEnemy(bullet,enemy){this.hitRivalBullet(bullet,enemy);}
    checkEnemyContact(){}
    checkEnemyBulletContact(){}
    updateEnemyBullets(){}updateNearestEnemyHealth(){this.enemyHpBar?.clear();this.enemyHpText?.setVisible(false);}drawOffscreenArrows(){this.offscreenArrows?.clear();}findNearestEnemyGlobal(){return this.rival?.active?this.rival:null;}isEnemyVisible(enemy){return enemy===this.rival&&enemy?.active;}getRemainingEnemies(){return 0;}finishLevel(){}failLevel(){this.finish(false);}exitWithoutReward(){this.finish(false);}
    update(time,delta){if(this.runtimeFailed||this.ended)return;try{this.updateWorld(time,delta);this.resolveRivalBulletContacts();this.publishState(time);this.updateArenaHud();}catch(error){this.ended=true;roomSay(`竞技场运行异常：${error.message||error}`,true);console.error('[行于无垠 PK]',error);}}
    resolveRivalBulletContacts(){
      const rivalBody=this.rival?.body;if(!rivalBody||!this.playerBullets)return;
      this.playerBullets.getChildren().forEach(bullet=>{
        if(!bullet?.active||!bullet.body)return;
        const body=bullet.body;
        if(body.right>rivalBody.left&&body.left<rivalBody.right&&body.bottom>rivalBody.top&&body.top<rivalBody.bottom)this.hitRivalBullet(bullet,this.rival);
      });
    }
    syncRival(){
      const remote=state.peerState;if(!remote||!this.rival?.active)return;const x=Phaser.Math.Clamp(Number(remote.x)||this.rival.x,this.rival.body.width/2,WORLD_W-this.rival.body.width/2),y=Phaser.Math.Clamp(Number(remote.y)||this.rival.y,50,this.floorTop-this.rival.body.height/2);this.rival.setPosition(Phaser.Math.Linear(this.rival.x,x,.42),Phaser.Math.Linear(this.rival.y,y,.42));this.rival.body.updateFromGameObject();this.rival.hp=Math.max(0,Number(remote.hp??this.rival.hp));this.rival.maxHp=Math.max(1,Number(remote.maxHp??this.rival.maxHp));
      // Hit events are also carried by state packets. This closes the small
      // race where a Broadcast arrives before the scene is ready or is dropped
      // during a reconnect.
      if(Array.isArray(remote.hits))remote.hits.forEach(hit=>{const id=String(hit?.id||'');if(id&&!this.appliedStateHitIds.has(id)){this.appliedStateHitIds.add(id);this.receivePvpHit(hit);}});
      if(remote.matchResult&&!state.finished)this.finish(remote.matchResult.winner===state.role,true);
      else if(Number(remote.hp)<=0&&!state.finished)this.finish(true,true);
      if(Array.isArray(remote.shotEvents)&&remote.shotEvents.length)this.remoteShot({bullets:remote.shotEvents});
      if(Array.isArray(remote.shots)&&remote.shots.length)this.remoteShot({bullets:remote.shots});
      const left=remote.leftFace??(Math.cos(Number(remote.aim)||0)<0),moving=!!remote.moving,jumping=!!remote.jumping;this.rivalArt.setTexture(jumping?(left?'heroJumpL':'heroJumpR'):moving?(left?'heroMoveL':'heroMoveR'):(left?'heroStandL':'heroStandR')).setDisplaySize(52,78).setPosition(this.rival.x,this.rival.body.bottom);
      const key=remote.weaponArt||'weaponPistol',sizes={weaponPistol:[46,31],weaponShotgun:[54,20],weaponSmg:[52,31],weaponLaser:[58,33],weaponSniper:[60,22],weaponDagger:[28,42],weaponBlade:[32,58]},angle=Number(remote.aim)||0,handX=this.rival.x+(left?-13:13),handY=this.rival.body.bottom-48;this.rivalWeapon.setTexture(key).setDisplaySize(...(sizes[key]||sizes.weaponPistol)).setPosition(handX,handY).setRotation(remote.mode==='melee'?angle+Math.PI/2:angle).setOrigin(remote.mode==='melee'?.5:.12,remote.mode==='melee'?.9:.5).setFlipY(remote.mode!=='melee'&&Math.cos(angle)<0);
      this.rivalLaser.clear();if(remote.laserActive)this.rivalLaser.lineStyle(4,0xff4df3,.9).lineBetween(handX,handY,this.player.x,this.player.body.bottom-40);
    }
    publishState(time){if(time-this.lastNetAt<NET_MS)return;this.lastNetAt=time;const p=this.player;const shotEvents=this.outgoingShots.splice(0,96);send('state',{seq:++state.stateSeq,x:p.x,y:p.y,hp:this.hp,maxHp:this.maxHp,armor:this.armor,armorMax:this.armorMax,shield:this.energyShield,shieldMax:this.energyShieldMax,energy:this.energy,aim:this.getWeaponMuzzle().angle,leftFace:this.leftFace,moving:Math.abs(p.body.velocity.x)>1,jumping:this.heroJumping,weaponArt:this.getWeaponTextureKey(),mode:this.combatMode,laserActive:this.activeWeapon==='laser'&&this.laserActiveUntil>time,hits:this.hitLog.slice(-24),shotEvents});}
    updateArenaHud(){const weapon=this.combatMode==='melee'?(this.meleeWeapon==='blade'?'长刀':'匕首'):(this.activeWeapon==='smg'?'冲锋枪':this.activeWeapon==='laser'?'激光枪':this.activeWeapon==='sniper'?'狙击枪':this.spreadShots?'霰弹枪':'手枪'),damage=this.combatMode==='melee'?this.getMeleeWeaponStats().damage:(this.activeWeapon==='laser'?this.laserDamage:this.activeWeapon==='sniper'?this.sniperDamage:this.activeWeapon==='smg'?this.smgDamage:this.atk+this.ammoDamageBonus);hostHud.textContent=`我方 ${this.formatHealth(this.hp)}/${this.formatHealth(this.maxHp)} · ${weapon} · 伤害 ${this.formatHealth(damage)}`;peerHud.textContent=`对手 ${this.formatHealth(this.rival?.hp)}/${this.formatHealth(this.rival?.maxHp)}`;matchHud.textContent=`竞技场 1500 · ${this.energy}/100 能量 · ${this.combatMode==='melee'?'近战':'远程'}`;}
    damageEnemy(enemy,amount,source='ability',applyMaster=true){if(enemy!==this.rival||!enemy?.active||this.ended)return;const raw=Math.max(0,Number(amount)||0)*(applyMaster?this.masterDamageMultiplier():1)*(this.assassinationBuffUntil>this.time.now?this.assassinationDamageMultiplier:1)+this.armorOverloadDamageBonus;this.sendHit(raw,source);this.meleeHitEffect?.(enemy,source==='melee'?0x9ef5ff:0xffd166);}
    hitRivalBullet(bullet,target){if(!bullet?.active||target!==this.rival)return;const originX=Number(bullet.getData('originX')??bullet.x),originY=Number(bullet.getData('originY')??bullet.y),vector=this.ammoLevel>=60?1+Math.floor(Math.hypot(bullet.x-originX,bullet.y-originY)/45)*.05:1;let damage=(Number(bullet.getData('damage'))||this.atk)*vector*this.masterDamageMultiplier()*(this.assassinationBuffUntil>this.time.now?this.assassinationDamageMultiplier:1)+this.armorOverloadDamageBonus;if(bullet.getData('elemental')&&bullet.getData('elementType')==='shock')damage*=1.25;if(this.ammoLevel>=95)damage+=this.rival.maxHp*.025;if(bullet.getData('dissolve'))damage+=this.rival.maxHp*(this.ammoLevel>=100||this.overloadUntil>this.time.now?.2:.12);this.sendHit(damage,bullet.getData('source')||'bullet');bullet.destroy();this.burstEffect(this.rival.x,this.rival.y,0xfff4c2,.8);}
    sendHit(damage,source='ability'){if(Number.isFinite(damage)&&damage>0&&!this.ended){const hit={id:`${state.role}-${++this.hitSeq}`,damage,source,at:Date.now()};this.hitLog.push(hit);if(this.hitLog.length>48)this.hitLog.splice(0,this.hitLog.length-48);send('hit',hit);}}
    receivePvpHit(packet){if(this.ended)return;const id=String(packet?.id||'');if(id&&this.receivedHitIds.has(id))return;if(id){this.receivedHitIds.add(id);if(this.receivedHitIds.size>600){const keep=[...this.receivedHitIds].slice(-300);this.receivedHitIds=new Set(keep);}}const amount=Math.max(0,Number(packet.damage)||0);if(!amount)return;/* A network hit has no local enemy object. Passing rival here made armor reflection bounce back through Broadcast forever. */combat.Game.prototype.damage.call(this,amount,null);if(this.hp<=0)this.finish(false);}
    meleeAttack(time){const ready=this.meleeNextAttackAt;combat.Game.prototype.meleeAttack.call(this,time);if(this.meleeNextAttackAt!==ready)send('skill',{kind:'melee',x:this.player.x,y:this.player.body.bottom-48,angle:this.getWeaponMuzzle().angle,blade:this.meleeWeapon==='blade'});}
    shoot(){const before=this.snapshotBullets();combat.Game.prototype.shoot.call(this);this.sendCreatedBullets(before);}
    firePistolSecondBurst(...args){const before=this.snapshotBullets();combat.Game.prototype.firePistolSecondBurst.apply(this,args);this.sendCreatedBullets(before);}
    fireRadial(...args){const before=this.snapshotBullets();combat.Game.prototype.fireRadial.apply(this,args);this.sendCreatedBullets(before);}
    fireSpread(...args){const before=this.snapshotBullets();combat.Game.prototype.fireSpread.apply(this,args);this.sendCreatedBullets(before);}
    snapshotBullets(){return new Set((this.playerBullets?.getChildren()||[]).filter(b=>b.active));}
    sendCreatedBullets(before){const added=(this.playerBullets?.getChildren()||[]).filter(b=>b.active&&b.body&&!before.has(b));if(added.length){const bullets=added.map(b=>{const id=`${state.role}-shot-${++this.shotSeq}`;b.setData('netId',id);return {id,x:b.x,y:b.y,vx:b.body.velocity.x,vy:b.body.velocity.y,angle:b.rotation,damage:Number(b.getData('damage'))||0,tint:b.tintTopLeft||0xfff4c2,expires:Math.max(250,Number(b.getData('expires'))-this.time.now)}});this.outgoingShots.push(...bullets);send('shot',{bullets});}}
    remoteShot(packet){if(this.ended||!this.enemyBullets||!this.player?.body||!Array.isArray(packet.bullets))return;packet.bullets.slice(0,180).forEach(spec=>{const id=String(spec.id||'');if(id&&this.remoteShotIds.has(id))return;if(id){this.remoteShotIds.add(id);if(this.remoteShotIds.size>1200){const keep=[...this.remoteShotIds].slice(-600);this.remoteShotIds=new Set(keep);}}const x=Number(spec.x),y=Number(spec.y),vx=Number(spec.vx),vy=Number(spec.vy);if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(vx)||!Number.isFinite(vy))return;const bullet=this.enemyBullets.create(x,y,'bullet');bullet.setActive(true).setVisible(true).setDepth(6).setAlpha(1);bullet.body.allowGravity=false;bullet.body.setSize(12,6,true);bullet.setVelocity(vx,vy);bullet.setRotation(Number(spec.angle)||0);bullet.setTint(Number(spec.tint)||0xfff4c2);bullet.setData('damage',Math.max(0,Number(spec.damage)||0));bullet.setData('owner','peer');bullet.setData('expires',this.time.now+Math.min(2200,Math.max(80,Number(spec.expires)||1200)));});}
    useDash(time){const before=this.player.x;combat.Game.prototype.useDash.call(this,time);if(this.player.x!==before)send('skill',{kind:'dash',x:this.player.x,y:this.player.y});}useTrackingDash(time){const before=this.player.x;combat.Game.prototype.useTrackingDash.call(this,time);if(this.player.x!==before)send('skill',{kind:'tracking',x:this.player.x,y:this.player.y});}useAirstrike(time){const before=this.player.x;combat.Game.prototype.useAirstrike.call(this,time);if(this.player.x!==before)send('skill',{kind:'airstrike',x:this.player.x,y:this.player.y});}useAssassination(time){const before=this.player.x;combat.Game.prototype.useAssassination.call(this,time);if(this.player.x!==before)send('skill',{kind:'assassination',x:this.player.x,y:this.player.y});}useUltimate(){const energy=this.energy,before=this.playerBullets?.getChildren().length||0;combat.Game.prototype.useUltimate.call(this);if(this.energy!==energy){this.sendCreatedBullets(before);send('skill',{kind:'ultimate',x:this.player.x,y:this.player.y});}}remoteSkill(packet){if(!packet||!this.rivalArt)return;if(packet.kind==='melee'){const g=this.add.graphics().setDepth(14),range=packet.blade?150:100;g.lineStyle(6,packet.blade?0x62d9ee:0xbd9aff,.9).arc(Number(packet.x)||this.rival.x,Number(packet.y)||this.rival.y,range,Number(packet.angle||0)-.5,Number(packet.angle||0)+.5);this.tweens.add({targets:g,alpha:0,duration:180,onComplete:()=>g.destroy()});return;}this.burstEffect(Number(packet.x)||this.rival.x,Number(packet.y)||this.rival.y,packet.kind==='ultimate'?0xffd166:0xbd9aff,1.15);}
    finish(won,remote=false){
      if(this.ended&&!this.resultSubmitted)return;
      const outcome={winner:won?state.role:(state.role==='host'?'guest':'host'),at:Date.now()};
      if(!remote){send('result',outcome);send('state',{seq:++state.stateSeq,x:this.player?.x,y:this.player?.y,hp:0,maxHp:this.maxHp,aim:this.getWeaponMuzzle?.().angle||0,leftFace:this.leftFace,moving:false,jumping:false,weaponArt:this.getWeaponTextureKey?.()||'weaponPistol',mode:this.combatMode,matchResult:outcome,hits:this.hitLog?.slice(-24)||[],shotEvents:[]});}
      this.ended=true;this.done=true;state.finished=true;this.smgFiring=false;this.touchFiring=false;this.player?.setVelocity(0,0);this.physics?.world&&(this.physics.world.isPaused=true);
      if(state.match&&!this.resultSubmitted){
        this.resultSubmitted=true;
        void rpc('platformer_pk_submit_result',{p_match_id:state.match.id,p_won:won}).then(result=>{
          if(result?.settled)roomSay(won?'你已获胜，押注已结算。':'你已失败，押注已结算。',!won);
          else roomSay(won?'你已获胜，等待对手提交结果。':'你已失败，等待结算完成。',!won);
        }).catch(error=>{
          this.resultSubmitted=false;
          roomSay(error.message||'对局结果提交失败，请再次点击退出/结束。',true);
        });
      }
      roomSay(won?'你已获胜，正在结算押注。':'你已失败，正在结算押注。',!won);
    }
  }
  function startArena(){if(!combat)return roomSay('单机战斗模块尚未加载，请刷新页面后重试。',true);arena.classList.remove('pk-hidden');$('pk-phaser').innerHTML='';state.finished=false;state.peerSeq=-1;state.stateSeq=0;state.peerState=state.peerState||{};const game=new Phaser.Game({type:Phaser.AUTO,parent:'pk-phaser',width:VIEW_W,height:VIEW_H,backgroundColor:'#091724',physics:{default:'arcade',arcade:{gravity:{y:900},debug:false}},scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},scene:PkArenaScene});state.scene=game.scene.getScene('PkArenaScene');}
  open.addEventListener('click',()=>{panel.hidden=false;open.hidden=true});$('pk-close-button')?.addEventListener('click',()=>{panel.hidden=true;open.hidden=false});$('pk-create-button')?.addEventListener('click',createRoom);$('pk-join-button')?.addEventListener('click',join);$('pk-accept-button')?.addEventListener('click',accept);$('pk-wager-button')?.addEventListener('click',wager);$('pk-ready-button')?.addEventListener('click',ready);$('pk-leave-button')?.addEventListener('click',leave);$('pk-copy-button')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(code.textContent);roomSay('邀请码已复制。')}catch(_){roomSay('复制失败，请手动复制邀请码。',true)}});window.addEventListener('xingyu:authenticated',()=>open.hidden=false);if(session())open.hidden=false;window.addEventListener('beforeunload',()=>{try{state.channel?.unsubscribe()}catch(_){}});
})();
