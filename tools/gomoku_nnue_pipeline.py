"""Incremental loss distillation + varied self-play + conservative local selection."""
import argparse
import copy
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import random
import re
import time

import numpy as np
from gomoku_nnue_common import (ROOT, BASE, NET, Engine, digest, write_json,
    production_fingerprints, teacher_assets, replay, trajectory_id, game_split, won)


def collect_games():
    games, skipped = {}, []
    folders = sorted(p for p in ROOT.iterdir() if p.is_dir() and re.fullmatch(r'五子棋训练数据\d+',p.name))
    folders += [BASE / 'selfplay']
    for folder in folders:
        if not folder.exists():
            continue
        for file in sorted(folder.glob('gomoku-*.json')):
            try:
                g = json.loads(file.read_text(encoding='utf8'))
                history = [{k:m[k] for k in ('row','col','player')} for m in g['moves']]
                _, winner = replay(history,require_complete=True)
                if 'result' in g:
                    color = g.get('ai_color', g.get('model_color'))
                    expected = 'draw' if winner is None else ('win' if winner == color else 'loss')
                    if g['result'] != expected:
                        raise ValueError('Result disagrees with complete board')
                gid = trajectory_id(history)
                loss = float(g.get('model_version',0)) == 10.1 and g.get('result') == 'loss'
                if gid not in games:
                    games[gid] = {'id':gid,'history':history,'winner':winner,'ultraLoss':loss,'sources':[str(file.relative_to(ROOT))]}
                else:
                    games[gid]['ultraLoss'] |= loss
                    games[gid]['sources'].append(str(file.relative_to(ROOT)))
            except (ValueError, KeyError, TypeError) as e:
                skipped.append({'source':str(file),'reason':str(e)})
    return games, skipped


def label_games(games, time_ms=10000, depth=32, stride=2, limit=0):
    """Teacher search caches include engine/weight/budget; no loser's-move policy."""
    cache = BASE / 'cache/labels'
    cache.mkdir(parents=True,exist_ok=True)
    teacher_hash = digest((teacher_assets()/NET).read_bytes())
    engine_hash = digest((BASE/'engine/pbrain-rapfi-windows-avx2.exe').read_bytes())
    count = 0
    with Engine() as teacher:
        for game in games.values():
            # Difficult games include every ply and both colors, normal games
            # alternate sampled parity so the corpus includes both colors too.
            step = 1 if game['ultraLoss'] else stride
            start = 0 if step == 1 else int(game['id'][:2],16) % step
            for ply in range(start,len(game['history']),step):
                history = game['history'][:ply]
                key = digest(json.dumps([teacher_hash,engine_hash,time_ms,depth,history],sort_keys=True).encode())
                file = cache / f'{key}.json'
                if not file.exists():
                    if limit and count >= limit:
                        return count
                    result = teacher.search(history,time_ms=time_ms,depth=depth)
                    if result['wld'] is None:
                        # No fabricated value target for moves with no score.
                        # Immediate own wins do have a rigorously known value.
                        b, _ = replay(history)
                        m = result['move'];b[m['row']][m['col']] = m['player']
                        if won(b,m['row'],m['col'],m['player']):
                            result['wld']=[1.,0.,0.]
                        else:
                            continue
                    write_json(file,{'schema':1,'history':history,'teacher':result,
                                     'budgetMs':time_ms,'maxDepth':depth,'engineSha256':engine_hash})
                    count += 1
                    print('LABEL', game['id'][:10], ply, result['evaluation'],flush=True)
    return count


def dataset_rows(games, time_ms, depth):
    teacher_hash = digest((teacher_assets()/NET).read_bytes())
    engine_hash = digest((BASE/'engine/pbrain-rapfi-windows-avx2.exe').read_bytes())
    rows = {'train':[], 'val':[]}
    # If identical positions occur in different games, assign the entire linked
    # component to one split. This avoids prefix/opening leakage across games.
    parents={gid:gid for gid in games}
    def find(x):
        while parents[x]!=x:
            parents[x]=parents[parents[x]];x=parents[x]
        return x
    owners={}
    for gid,g in games.items():
        for ply in range(7,len(g['history'])):
            b,_=replay(g['history'][:ply]);color=ply%2+1
            relative=np.where(np.asarray(b)==color,1,np.where(np.asarray(b)==3-color,2,0))
            # Symmetry augmentation cannot put the same late board into both
            # splits. Common first six plies are excluded from this curriculum.
            key=min(np.rot90(v,k).tobytes() for v in [relative,np.fliplr(relative)] for k in range(4))
            if key in owners:
                a,c=find(gid),find(owners[key]);parents[max(a,c)]=min(a,c)
            else:owners[key]=gid
    seen=set()
    for gid,g in games.items():
        split=game_split(find(gid))
        for ply in range(7,len(g['history'])):
            h=g['history'][:ply]
            key=digest(json.dumps([teacher_hash,engine_hash,time_ms,depth,h],sort_keys=True).encode())
            file=BASE/'cache/labels'/f'{key}.json'
            if not file.exists():continue
            sample=json.loads(file.read_text(encoding='utf8'))
            board,_=replay(h);color=ply%2+1
            pos=json.dumps([board,color])
            if pos in seen:continue
            seen.add(pos)
            target=sample['teacher']['wld']
            if target is None:continue
            # Small empirical contribution, not a blanket losing-game label.
            outcome=[0.,0.,1.] if g['winner'] is None else ([1.,0.,0.] if g['winner']==color else [0.,1.,0.])
            value=[.85*a+.15*b for a,b in zip(target,outcome)]
            rows[split].append({'board':board,'color':color,'policy':sample['teacher']['move'],
                                'value':value,'game':gid,'loss':g['ultraLoss']})
    return rows


def train_candidate(args, games):
    import torch
    import torch.nn.functional as F
    from gomoku_nnue_model import FrozenMappingHeads
    rows=dataset_rows(games,args.teacher_ms,args.teacher_depth)
    if len(rows['train'])<2 or not rows['val']:
        raise RuntimeError(f'Need independent non-overlapping train AND validation games; train={len(rows["train"])}, val={len(rows["val"])}. Generate varied self-play and label it first.')
    write_json(BASE/'cache/latest-dataset.json',{'trainPositions':len(rows['train']),
        'validationPositions':len(rows['val']),'trainGameIds':sorted(set(s['game'] for s in rows['train'])),
        'validationGameIds':sorted(set(s['game'] for s in rows['val']))})
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    run=BASE/'runs'/stamp;run.mkdir(parents=True)
    torch.manual_seed(args.seed);rng=random.Random(args.seed)
    device='cuda' if torch.cuda.is_available() and not args.cpu else 'cpu'
    model=FrozenMappingHeads(args.parent_weight).to(device)
    model.assert_roundtrip()
    if args.resume:
        ckpt=torch.load(args.resume,map_location='cpu',weights_only=True)
        if ckpt['baseWeightSha256']!=model.source_hash:
            raise ValueError('Checkpoint was initialized from a different parent weight')
        model.load_state_dict(ckpt['state_dict'])
    parameters=[p for p in model.parameters() if p.requires_grad]
    anchors=[p.detach().clone() for p in parameters]
    optimizer=torch.optim.AdamW(parameters,lr=args.lr,weight_decay=1e-7)
    def batch(samples,augment=False):
        boards=[];policies=[];values=[]
        for s in samples:
            b=np.asarray(s['board']);r,c=s['policy']['row'],s['policy']['col']
            if augment:
                sym=rng.randrange(8)
                if sym>=4:b=np.fliplr(b);c=14-c
                for _ in range(sym%4):b=np.rot90(b,k=-1);r,c=c,14-r
            # The site's protocol uses x=row,y=col. The native evaluator reads
            # NCHW as [y,x], so transpose BOTH input board and policy target.
            b=b.T;r,c=c,r
            boards.append(np.stack([b==s['color'],b==3-s['color']]).astype(np.float32))
            policies.append(r*15+c);values.append(s['value'])
        x=torch.tensor(np.stack(boards),device=device)
        data={'board_input':x,'stm_input':torch.zeros((len(samples),1),device=device)}
        output=model(data)
        policy=output['policy'].reshape(len(samples),225)
        policy=policy.masked_fill(x.sum(1).reshape(len(samples),225)>0,-1e9)
        value_loss=-(torch.tensor(values,device=device)*F.log_softmax(output['value'],dim=1)).sum(1).mean()
        policy_loss=F.cross_entropy(policy,torch.tensor(policies,device=device))
        return value_loss+policy_loss
    def validation():
        model.eval()
        with torch.no_grad():
            losses=[(float(batch(rows['val'][i:i+args.batch])),len(rows['val'][i:i+args.batch]))
                    for i in range(0,len(rows['val']),args.batch)]
        return sum(v*n for v,n in losses)/sum(n for _,n in losses)
    baseline=validation();best=baseline;best_state=copy.deepcopy(model.state_dict());best_step=0
    weights=[3 if s['loss'] else 1 for s in rows['train']]
    log=[]
    for step in range(1,args.steps+1):
        model.train();optimizer.zero_grad(set_to_none=True)
        samples=rng.choices(rows['train'],weights=weights,k=min(args.batch,len(rows['train'])))
        loss=batch(samples,augment=True)
        # Retain teacher behavior, avoid tiny-loss-corpus catastrophic forgetting.
        anchor=sum((p-a).square().mean() for p,a in zip(parameters,anchors))*.05
        (loss+anchor).backward();torch.nn.utils.clip_grad_norm_(parameters,1.0);optimizer.step()
        with torch.no_grad():
            named=dict(model.named_parameters())
            for rule in model.weight_clipping:
                for name in rule['params']:
                    if name in named:named[name].clamp_(rule['min_weight'],rule['max_weight'])
        if step%args.eval_every==0 or step==args.steps:
            val=validation();log.append({'step':step,'trainLoss':float(loss.detach()),'validationLoss':val})
            torch.save({'state_dict':model.state_dict(),'baseWeightSha256':model.source_hash,'step':step},run/'last.pt')
            if val<best:
                best=val;best_state=copy.deepcopy(model.state_dict());best_step=step
            print('TRAIN',step,'validation',round(val,5),flush=True)
    # Export actual trained last heads even if best remains baseline; manifest
    # clearly rejects them as a strength promotion. Keep both checkpoints.
    model.export(run/'candidate-last.bin.lz4')
    model.load_state_dict(best_state)
    torch.save({'state_dict':best_state,'baseWeightSha256':model.source_hash,'step':best_step},run/'best.pt')
    model.export(run/'candidate-best.bin.lz4')
    info={'run':str(run),'mode':'exact frozen Mix9sVQ mapping+dwconv; train 146596 head parameters',
          'device':device,'steps':args.steps,'bestStep':best_step,'parentWeight':str(args.parent_weight or teacher_assets()/NET),
          'parentSha256':model.source_hash,'trainingPositions':len(rows['train']),'validationPositions':len(rows['val']),
          'trainGameIds':sorted(set(s['game'] for s in rows['train'])),
          'validationGameIds':sorted(set(s['game'] for s in rows['val'])),
          'baselineValidationLoss':baseline,'bestValidationLoss':best,'validationImproved':best<baseline,
          'strengthAccepted':False,'history':log,'teacherMs':args.teacher_ms,'teacherDepth':args.teacher_depth}
    write_json(run/'manifest.json',info)
    return run,info


def make_opening(seed):
    rng=random.Random(seed)
    history=[{'row':rng.randint(4,10),'col':rng.randint(4,10),'player':1}]
    for ply in range(1,rng.choice([3,5,7])):
        b,_=replay(history)
        cells=[(r,c) for r in range(3,12) for c in range(3,12) if not b[r][c]]
        r,c=rng.choice(cells);history.append({'row':r,'col':c,'player':ply%2+1})
    return history


def play_game(black,white,opening,time_ms,depth):
    h=copy.deepcopy(opening);replay(h);stats=[]
    engines=[Engine(black),Engine(white)]
    try:
        while len(h)<225:
            color=len(h)%2+1
            result=engines[color-1].search(h,time_ms=time_ms,depth=depth)
            h.append(result['move']);_,winner=replay(h)
            stats.append(result)
            if winner:return {'moves':h,'winner':winner,'complete':True,'search':stats}
        return {'moves':h,'winner':None,'complete':True,'search':stats}
    finally:
        for engine in engines:engine.close()


def selfplay_games(args, cycle=0,weight=None):
    folder=BASE/'selfplay';folder.mkdir(parents=True,exist_ok=True)
    generated=[]
    state_file=folder/'generation-state.json'
    state=json.loads(state_file.read_text(encoding='utf8')) if state_file.exists() else {'nextIndex':0}
    attempts=0
    while len(generated)<args.games:
        # Successive cycles/commands use a persistent index, never replay the
        # same empty-board deterministic game as supposedly new training data.
        index=state['nextIndex'];state['nextIndex']+=1;write_json(state_file,state)
        seed=args.seed+index
        attempts+=1
        if attempts>args.games*20:
            raise RuntimeError('Too many duplicate self-play trajectories; no fake game count')
        result=play_game(weight,weight,make_opening(seed),args.selfplay_ms,args.selfplay_depth)
        gid=trajectory_id(result['moves'])
        file=folder/f'gomoku-{gid}.json'
        if file.exists():continue
        result.update({'schema':'gomoku.nnue.local-selfplay.v1','seed':seed,'weight':str(weight or teacher_assets()/NET),
                       'cycle':cycle,'createdAt':datetime.now(timezone.utc).isoformat()})
        write_json(file,result);generated.append(gid)
        print('SELFPLAY',len(generated),'/',args.games,'plies',len(result['moves']),'winner',result['winner'],flush=True)
    return generated


def arena(candidate, incumbent,args,output):
    games=[];scores={1:[],2:[]}
    for pair in range(args.pairs):
        # Separate seed family from training openings; same opening, swapped
        # model colors per pair. This is local, never sent to Supabase.
        opening=make_opening(args.seed+1000000+pair)
        for color in [1,2]:
            result=play_game(candidate if color==1 else incumbent,
                             candidate if color==2 else incumbent,opening,args.arena_ms,args.arena_depth)
            score=.5 if result['winner'] is None else float(result['winner']==color)
            scores[color].append(score)
            result.update({'candidateColor':color,'pair':pair,'candidateScore':score})
            games.append(result);write_json(output,{'complete':False,'games':games})
            print('ARENA',pair+1,'color',color,'score',score,flush=True)
    all_scores=scores[1]+scores[2];n=len(all_scores);mean=sum(all_scores)/n
    # Conservative bound over paired means; deterministic games still depend
    # on different openings. Never claim universal optimality from this gate.
    pairs=[sum(g['candidateScore'] for g in games[i:i+2])/2 for i in range(0,len(games),2)]
    lower=max(0,float(np.mean(pairs)-math.sqrt(math.log(20)/(2*len(pairs)))))
    report={'complete':True,'games':games,'candidateScore':mean,'pairedHoeffdingLower95':lower,
            'blackScore':sum(scores[1])/len(scores[1]),'whiteScore':sum(scores[2])/len(scores[2]),
            'accepted':args.pairs>=12 and lower>.5 and all(sum(v)/len(v)>.5 for v in scores.values()),
            'limitations':'Paired bounded-score bound assumes independent openings; small arena evidence only, not optimal/universal strength.'}
    write_json(output,report);return report


def parser(mode):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--teacher-ms',type=int,default=10000)
    p.add_argument('--teacher-depth',type=int,default=32)
    p.add_argument('--stride',type=int,default=2)
    p.add_argument('--limit-labels',type=int,default=0,help='Development limit; zero labels all missing positions')
    p.add_argument('--steps',type=int,default=2000)
    p.add_argument('--batch',type=int,default=32)
    p.add_argument('--lr',type=float,default=.0001)
    p.add_argument('--eval-every',type=int,default=100)
    p.add_argument('--seed',type=int,default=1013)
    p.add_argument('--cpu',action='store_true')
    p.add_argument('--parent-weight',type=Path)
    p.add_argument('--resume',type=Path)
    p.add_argument('--prepare-only',action='store_true')
    p.add_argument('--skip-arena',action='store_true',help='Candidate stays unaccepted')
    p.add_argument('--pairs',type=int,default=12)
    p.add_argument('--arena-ms',type=int,default=75000)
    p.add_argument('--arena-depth',type=int,default=12)
    p.add_argument('--watch',action='store_true')
    p.add_argument('--poll-seconds',type=int,default=30)
    p.add_argument('--games',type=int,default=16)
    p.add_argument('--cycles',type=int,default=1)
    p.add_argument('--selfplay-ms',type=int,default=2000)
    p.add_argument('--selfplay-depth',type=int,default=24)
    p.add_argument('--generate-only',action='store_true')
    p.add_argument('--compare-initial',action='store_true',help='After training, run original weight vs candidate, both colors. Always saves results, never promotes automatically.')
    p.add_argument('--comparison-pairs',type=int,default=1)
    return p


def cycle_train(args):
    games,skipped=collect_games()
    write_json(BASE/'cache/data-audit.json',{'games':len(games),'ultraLosses':sum(g['ultraLoss'] for g in games.values()),'skipped':skipped})
    label_games(games,args.teacher_ms,args.teacher_depth,args.stride,args.limit_labels)
    if args.prepare_only:return None
    run,info=train_candidate(args,games)
    if args.compare_initial:
        comparison_args=copy.copy(args);comparison_args.pairs=args.comparison_pairs
        # A baseline-best checkpoint means training did not improve held-out
        # loss. Still compare the actually trained LAST candidate as requested,
        # with that warning recorded, rather than secretly testing the original.
        candidate=run/('candidate-best.bin.lz4' if info['validationImproved'] else 'candidate-last.bin.lz4')
        result=arena(candidate,None,comparison_args,run/'initial-comparison.json')
        info['initialComparison']={'candidate':str(candidate),'games':len(result['games']),
            'score':result['candidateScore'],'blackScore':result['blackScore'],'whiteScore':result['whiteScore'],
            'notStrengthAcceptance':True}
        write_json(run/'manifest.json',info)
    if info['validationImproved'] and not args.skip_arena:
        result=arena(run/'candidate-best.bin.lz4',args.parent_weight,args,run/'arena.json')
        info['strengthAccepted']=result['accepted']
        write_json(run/'manifest.json',info)
    print('CANDIDATE',run,'accepted',info['strengthAccepted'],flush=True)
    return run,info


def main(mode):
    args=parser(mode).parse_args()
    for name in ['steps','batch','eval_every','stride','games','cycles','pairs','comparison_pairs','teacher_ms','selfplay_ms','arena_ms','poll_seconds']:
        if getattr(args,name)<=0:raise ValueError(f'{name} must be positive')
    (BASE/'cache').mkdir(parents=True,exist_ok=True)
    before=production_fingerprints()
    for source in (ROOT/'public').rglob('*'):
        if source.is_file() and source.suffix in {'.html','.js'}:
            if 'training/gomoku-nnue' in source.read_text(encoding='utf8',errors='replace'):
                raise RuntimeError(f'Production page unexpectedly references local training directory: {source}')
    isolation=BASE/'cache/isolation.json'
    write_json(isolation,{'before':before,'productionRoot':str(ROOT/'public'),'trainingRoot':str(BASE),
                          'checkedAfter':False,'siteImportsTrainingDirectory':False})
    try:
        if mode=='selfplay':
            champion=args.parent_weight
            for cycle in range(args.cycles):
                selfplay_games(args,cycle,champion)
                if args.generate_only:continue
                args.parent_weight=champion
                trained=cycle_train(args)
                if trained and trained[1]['strengthAccepted']:
                    champion=trained[0]/'candidate-best.bin.lz4'
                    write_json(BASE/'runs/champion.json',{'weight':str(champion),'manifest':str(trained[0]/'manifest.json')})
            return
        state_path=BASE/'cache/loss-train-state.json'
        state=json.loads(state_path.read_text(encoding='utf8')) if state_path.exists() else {'processedLossGames':[]}
        while True:
            games,_=collect_games()
            losses={gid for gid,g in games.items() if g['ultraLoss']}
            new=losses-set(state['processedLossGames'])
            if new:
                result=cycle_train(args)
                if result:
                    state['processedLossGames']=sorted(set(state['processedLossGames'])|new)
                    state['lastRun']=str(result[0]);write_json(state_path,state)
            else:print('No new unique complete Ultra loss games; no duplicate training.',flush=True)
            if not args.watch:break
            time.sleep(args.poll_seconds)
    finally:
        after=production_fingerprints()
        write_json(isolation,{'before':before,'after':after,'checkedAfter':True,
                              'productionUnchanged':after==before,'trainingRoot':str(BASE),
                              'siteImportsTrainingDirectory':False})
        if after!=before:
            raise RuntimeError('Production resources changed during local training; investigate concurrent edits')

