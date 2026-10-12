import fs from 'node:fs';
import {fixtures,createProver,replay,won,reportDir} from './gomoku-ultra-regression.mjs';

// This deliberately tests the previously UNPROVED alternative, without treating
// an absent VCF as a safe label. Exhaust all white replies after Black's quiet move.
const history=[...fixtures()[0].history,{row:2,col:9,player:2},{row:5,col:7,player:1}];
const {board}=replay(history),results=[],prove=createProver();
for(let row=0;row<15;row++)for(let col=0;col<15;col++)if(!board[row][col]) {
  board[row][col]=2;const counterWin=won(board,row,col,2);board[row][col]=0;
  const proof=counterWin?null:prove([...history,{row,col,player:2}],1,2000);
  results.push({row,col,counterWin,proof});
}
const report={history,coordinates:'zero-based row,col',attackingMove:[5,7],defenses:results.length,
  allDefensesProvedLosing:results.every(r=>!r.counterWin&&r.proof?.proved),results};
fs.writeFileSync(reportDir+'/alternative-defense-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({defenses:report.defenses,allDefensesProvedLosing:report.allDefensesProvedLosing,
  unproved:results.filter(r=>!r.proof?.proved)}));
