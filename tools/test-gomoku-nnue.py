"""Short pipeline checks only: no self-play games, no long training, no promotion."""
import json
import tempfile
from pathlib import Path
import numpy as np
import torch
from gomoku_nnue_common import (BASE, NET, Engine, teacher_assets, production_fingerprints,
                               replay, score_to_wld, trajectory_id, write_json)
from gomoku_nnue_model import FrozenMappingHeads
from gomoku_nnue_pipeline import make_opening, collect_games, parser


def main():
    before=production_fingerprints()
    model=FrozenMappingHeads()
    model.assert_roundtrip()
    native=BASE/'cache/roundtrip.bin.lz4'
    model.export(native)
    import lz4.frame
    assert lz4.frame.decompress(native.read_bytes())==lz4.frame.decompress((teacher_assets()/NET).read_bytes())
    for seed in range(100):
        replay(make_opening(seed))
    for score in ['+M7','-M12','-400','0','900']:
        values=score_to_wld(score)
        assert abs(sum(values)-1)<1e-6 and all(0<=v<=1 for v in values)
    # Same search engine/limits and same bytes must return the same result.
    histories=[ [{'row':5,'col':6,'player':1}],
        [{'row':7,'col':7,'player':1},{'row':7,'col':8,'player':2}] ]
    searches=[]
    for history in histories:
        with Engine() as initial,Engine(native) as clone:
            a=initial.search(history,1000,8);b=clone.search(history,1000,8)
            assert a['move']==b['move'] and a['evaluation']==b['evaluation']
            searches.append({'color':len(history)%2+1,'move':a['move'],'eval':a['evaluation']})
    # Actual GPU forward/backward and export/load compatibility. This is one
    # synthetic optimizer step, not a self-play training run or strength claim.
    device='cuda' if torch.cuda.is_available() else 'cpu'
    model=model.to(device)
    x=torch.zeros((2,2,15,15),device=device);x[:,1,6,5]=1
    output=model({'board_input':x,'stm_input':torch.zeros((2,1),device=device)})
    loss=torch.nn.functional.cross_entropy(output['value'],torch.tensor([0,1],device=device))
    loss+=torch.nn.functional.cross_entropy(output['policy'].reshape(2,225),torch.tensor([110,112],device=device))
    loss.backward()
    assert any(p.grad is not None and torch.isfinite(p.grad).all() and p.grad.abs().sum()>0
               for p in model.parameters() if p.requires_grad)
    opt=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=.0001)
    opt.step()
    candidate=BASE/'cache/one-step-smoke.bin.lz4';model.export(candidate)
    with Engine(candidate) as changed:
        searches.append(changed.search(histories[0],1000,8))
    games,skipped=collect_games()
    assert len(games)>1 and any(g['ultraLoss'] for g in games.values())
    args=parser('selfplay').parse_args(['--games','100','--skip-arena','--compare-initial','--comparison-pairs','1'])
    assert args.games==100 and args.comparison_pairs==1
    # Exercise the orchestration's checkpoint/validation/export path with a
    # separate synthetic batch, without generating any self-play or teacher
    # corpus. Restore the function immediately afterwards.
    import gomoku_nnue_pipeline as pipeline
    original_rows=pipeline.dataset_rows
    synthetic={'board':[[0]*15 for _ in range(15)],'color':2,
               'policy':{'row':7,'col':7},'value':[.1,.85,.05],
               'game':'smoke-train','loss':False}
    synthetic['board'][5][6]=1
    other=json.loads(json.dumps(synthetic));other['game']='smoke-val'
    other['board'][5][6]=0;other['board'][8][8]=1
    pipeline.dataset_rows=lambda *a,**k:{'train':[synthetic,synthetic],'val':[other]}
    try:
        short=parser('selfplay').parse_args(['--steps','2','--batch','2','--eval-every','1','--skip-arena'])
        run,manifest=pipeline.train_candidate(short,{})
        manifest['smokeOnly']=True
        write_json(run/'manifest.json',manifest)
        assert (run/'last.pt').exists() and (run/'candidate-last.bin.lz4').exists()
        with Engine(run/'candidate-last.bin.lz4') as exported:
            exported.search(histories[0],1000,8)
    finally:pipeline.dataset_rows=original_rows
    assert production_fingerprints()==before
    report={'passed':True,'roundtripByteExact':True,'nativeBothColors':searches[:2],
            'gpuForwardBackward':device,'candidateEngineLoaded':True,'productionUnchanged':True,
            'gamesAudited':len(games),'skippedIncomplete':len(skipped),
            'checkpointPipelineSmoke':str(run),
            'note':'Synthetic two-step pipeline check only. No full self-play or long training was executed. Smoke candidates are not releases.'}
    write_json(BASE/'smoke-check.json',report)
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
