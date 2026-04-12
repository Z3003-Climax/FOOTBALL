// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — engine.js
// Bloc 3 : Moteur de match
// ═══════════════════════════════════════════════════════════════
//
// Architecture :
//   MatchEngine.simulateMatch(homeId, awayId, context?) → MatchResult
//
// Modèle :
//   1. OVR pondéré par poste pour chaque équipe (ATK / MID / DEF / GK)
//   2. xG (expected goals) calculé par la force relative ATK vs DEF
//   3. Distribution Binomiale Négative pour le nombre de buts
//   4. Événements : buts, passes décisives, minutes, notes, MOTM
//   5. Avantage domicile : +5% xG home
//   6. Forme (5 derniers matchs) : multiplicateur ±8%
//   7. Les upsets sont possibles mais rares
//
// ───────────────────────────────────────────────────────────────

'use strict';

const MatchEngine = (() => {

  // ─── RNG SEEDABLE ──────────────────────────────────────────
  function createRNG(seed) {
    if (seed == null) return () => Math.random();
    let s = seed >>> 0;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ─── POIDS PAR POSTE ───────────────────────────────────────
  const POS_WEIGHT = {
    ST:  { atk: 1.0, mid: 0.0, def: 0.0, gk: 0.0 },
    LW:  { atk: 0.8, mid: 0.2, def: 0.0, gk: 0.0 },
    RW:  { atk: 0.8, mid: 0.2, def: 0.0, gk: 0.0 },
    CAM: { atk: 0.6, mid: 0.4, def: 0.0, gk: 0.0 },
    CM:  { atk: 0.2, mid: 0.8, def: 0.0, gk: 0.0 },
    CDM: { atk: 0.0, mid: 0.5, def: 0.5, gk: 0.0 },
    LB:  { atk: 0.1, mid: 0.2, def: 0.7, gk: 0.0 },
    RB:  { atk: 0.1, mid: 0.2, def: 0.7, gk: 0.0 },
    CB:  { atk: 0.0, mid: 0.0, def: 1.0, gk: 0.0 },
    GK:  { atk: 0.0, mid: 0.0, def: 0.0, gk: 1.0 },
  };

  // Coefficient de passe décisive par poste
  const ASSIST_COEF = {
    CAM: 0.32, CM:  0.20, LW:  0.18, RW:  0.18,
    ST:  0.08, CDM: 0.05, LB:  0.06, RB:  0.06,
    CB:  0.03, GK:  0.01,
  };

  // Probabilité de marquer par poste
  const GOAL_COEF = {
    ST: 0.38, LW: 0.18, RW: 0.18, CAM: 0.12,
    CM: 0.06, CDM: 0.02, LB: 0.02, RB: 0.02,
    CB: 0.02, GK: 0.00,
  };

  // ─── OVR UTILITAIRES ───────────────────────────────────────
  function calcPlayerOVR(player) {
    if (player.ovr) return player.ovr;
    const s = player.stats || {};
    const pos = player.position || 'CM';
    if (pos === 'GK') {
      return Math.round(
        (s.rg || 75) * 0.35 + (s.mg || 75) * 0.35 +
        (s.puissance || 70) * 0.08 + (s.controle || 65) * 0.1 +
        (s.passe || 65) * 0.12
      );
    }
    const w = POS_WEIGHT[pos] || POS_WEIGHT.CM;
    const atk = (s.tir || 75) * 0.35 + (s.controle || 75) * 0.25 +
                (s.rapidite || 75) * 0.20 + (s.passe || 75) * 0.20;
    const def = (s.tacle || 70) * 0.45 + (s.puissance || 75) * 0.30 +
                (s.endurance || 75) * 0.25;
    return Math.round(atk * (w.atk + w.mid * 0.4) + def * (w.def + w.mid * 0.6) * 0.5);
  }

  // Sélectionne les 11 titulaires
  function selectStartingXI(players) {
    if (!players || players.length === 0) return [];
    const sorted = [...players].sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
    const xi = [];
    const usedIds = new Set();

    const slots = [
      ['GK'],
      ['CB','CB'],
      ['LB'],
      ['RB'],
      ['CDM','CM'],
      ['CM','CAM'],
      ['LW'],
      ['RW'],
      ['ST'],
    ];

    const altPositions = {
      GK:  ['GK'],
      CB:  ['CB','CDM'],
      LB:  ['LB','CB','CDM'],
      RB:  ['RB','CB','CDM'],
      CDM: ['CDM','CM','CB'],
      CM:  ['CM','CDM','CAM'],
      CAM: ['CAM','CM','LW','RW'],
      LW:  ['LW','CAM','ST'],
      RW:  ['RW','CAM','ST'],
      ST:  ['ST','LW','RW','CAM'],
    };

    for (const group of slots) {
      for (const slot of group) {
        const alts = altPositions[slot] || [slot];
        const candidate = sorted.find(p =>
          !usedIds.has(p.id || p.name) && alts.includes(p.position)
        );
        if (candidate) {
          xi.push({ ...candidate, slotPosition: slot });
          usedIds.add(candidate.id || candidate.name);
        }
      }
    }

    if (xi.length < 11) {
      for (const p of sorted) {
        if (xi.length >= 11) break;
        if (!usedIds.has(p.id || p.name)) {
          xi.push({ ...p, slotPosition: p.position });
          usedIds.add(p.id || p.name);
        }
      }
    }

    return xi.slice(0, 11);
  }

  // Calcule ATK / MID / DEF / GK d'une équipe
  function calcTeamScores(xi) {
    let atkW=0,atkSum=0,midW=0,midSum=0,defW=0,defSum=0,gkVal=75;
    for (const p of xi) {
      const pos = p.slotPosition || p.position || 'CM';
      const w   = POS_WEIGHT[pos] || POS_WEIGHT.CM;
      const o   = p.ovr || calcPlayerOVR(p);
      if (w.atk > 0) { atkSum += o*w.atk; atkW += w.atk; }
      if (w.mid > 0) { midSum += o*w.mid; midW += w.mid; }
      if (w.def > 0) { defSum += o*w.def; defW += w.def; }
      if (w.gk  > 0) { gkVal = o; }
    }
    return {
      atk: atkW > 0 ? atkSum/atkW : 75,
      mid: midW > 0 ? midSum/midW : 75,
      def: defW > 0 ? defSum/defW : 75,
      gk:  gkVal,
    };
  }

  // ─── DISTRIBUTION BINOMIALE NÉGATIVE ───────────────────────
  // r=3 : moins de variance que r=2 → upsets plus rares et réalistes
  // Football empirique : overdispersé mais pas au point de perdre 1-8
  function sampleNB(xG, rng, r=3) {
    if (xG <= 0) return 0;
    const p = r / (r + xG);
    let goals = 0;
    for (let i=0; i<r; i++) {
      let u = rng();
      if (u <= 0) u = 1e-10;
      goals += Math.floor(Math.log(u) / Math.log(1-p));
    }
    return Math.min(goals, 7);
  }

  // ─── xG ────────────────────────────────────────────────────
  // Calibration cible :
  //   Top vs Faible  → xG ~1.80 / 0.55  → win ~70%
  //   Top vs Fort    → xG ~1.45 / 0.95  → win ~55%
  //   Top vs Top     → xG ~1.25 / 1.20  → win ~48%
  //   Faible vs Top  → xG ~0.55 / 1.80  → win ~12%
  function calcXG(teamScores, oppScores, homeAdvantage, formMult) {
    const BASE_XG = 1.20;

    // ATK vs DEF : chaque point d'écart = 0.038 xG (sensibilité calibrée)
    const atkDiff  = (teamScores.atk - oppScores.def) * 0.038;

    // MID battle : influence plus faible (pressing, transition)
    const midDiff  = (teamScores.mid - oppScores.mid) * 0.010;

    // GK : un bon gardien réduit les buts adverses
    // opp GK OVR 90 → -0.044, opp GK OVR 70 → +0.044
    const gkEffect = -(oppScores.gk - 80) / 80 * 0.35;

    let xG = BASE_XG + atkDiff + midDiff + gkEffect + homeAdvantage + formMult;
    return Math.max(0.20, Math.min(3.0, xG));
  }

  // ─── FORME ─────────────────────────────────────────────────
  function calcFormMult(form) {
    if (!form || form.length === 0) return 0;
    const pts = form.slice(-5).reduce((s,r) => s+(r==='W'?3:r==='D'?1:0), 0);
    const max = form.slice(-5).length * 3;
    return ((pts/max) - 0.5) * 0.20;
  }

  // ─── ÉVÉNEMENTS ────────────────────────────────────────────
  function generateGoalEvents(xi, nbGoals, rng, isHome) {
    const events = [];
    const usedMinutes = new Set();

    const scorerPool = xi.map(p => ({ player:p, weight: GOAL_COEF[p.slotPosition||p.position]||0.01 }));
    const assistPool = xi.map(p => ({ player:p, weight: ASSIST_COEF[p.slotPosition||p.position]||0.01 }));

    for (let i=0; i<nbGoals; i++) {
      let minute;
      do {
        const raw = rng();
        if (raw < 0.55)       minute = Math.floor(rng()*45)+1;
        else if (raw < 0.90)  minute = Math.floor(rng()*35)+46;
        else                  minute = Math.floor(rng()*10)+81;
      } while (usedMinutes.has(minute));
      usedMinutes.add(minute);

      const scorer = weightedChoice(scorerPool, rng);
      let assistant = null;
      if (rng() < 0.78) {
        const candidates = assistPool.filter(a =>
          (a.player.id||a.player.name) !== (scorer.id||scorer.name)
        );
        assistant = weightedChoice(candidates, rng);
      }

      events.push({
        type:'goal', minute,
        scorer:    { id:scorer.id, name:scorer.name, position:scorer.slotPosition||scorer.position },
        assistant: assistant ? { id:assistant.id, name:assistant.name } : null,
        home: isHome,
      });
    }

    return events.sort((a,b) => a.minute - b.minute);
  }

  // ─── NOTES ─────────────────────────────────────────────────
  function generateRatings(xi, goals, rng, won) {
    const ratings = {};
    const baseWin  = won===true  ?  0.4 : 0;
    const baseLoss = won===false ? -0.3 : 0;
    for (const p of xi) {
      let rating = 6.0 + baseWin + baseLoss + (rng()-0.5)*1.6;
      rating += goals.filter(g => g.scorer && (g.scorer.id===p.id||g.scorer.name===p.name)).length * 0.7;
      rating += goals.filter(g => g.assistant && (g.assistant.id===p.id||g.assistant.name===p.name)).length * 0.4;
      ratings[p.id||p.name] = Math.round(Math.max(4.0, Math.min(10.0, rating))*10)/10;
    }
    return ratings;
  }

  // ─── CHOIX PONDÉRÉ ─────────────────────────────────────────
  function weightedChoice(pool, rng) {
    const total = pool.reduce((s,e) => s+e.weight, 0);
    let r = rng()*total;
    for (const entry of pool) {
      r -= entry.weight;
      if (r <= 0) return entry.player || entry;
    }
    return pool[pool.length-1].player || pool[pool.length-1];
  }

  // ═══════════════════════════════════════════════════════════
  // SIMULATE MATCH — fonction principale
  // ═══════════════════════════════════════════════════════════
  function simulateMatch(homeId, awayId, context={}) {
    const { canon, homeForm, awayForm, seed, neutral } = context;
    if (!canon) throw new Error('engine: canon est requis');

    const rng = createRNG(seed);

    const homeClub = canon.clubs[homeId];
    const awayClub = canon.clubs[awayId];
    if (!homeClub) throw new Error(`engine: club inconnu → ${homeId}`);
    if (!awayClub) throw new Error(`engine: club inconnu → ${awayId}`);

    const allPlayers = Object.values(canon.players);
    const homeXI = selectStartingXI(allPlayers.filter(p => p.club===homeId));
    const awayXI = selectStartingXI(allPlayers.filter(p => p.club===awayId));

    const homeScores = calcTeamScores(homeXI);
    const awayScores = calcTeamScores(awayXI);

    const homeAdv = neutral ? 0 : 0.12;
    const hForm   = calcFormMult(homeForm);
    const aForm   = calcFormMult(awayForm);

    const homeXG = calcXG(homeScores, awayScores, homeAdv, hForm);
    const awayXG = calcXG(awayScores, homeScores, 0,       aForm);

    const homeGoals = sampleNB(homeXG, rng);
    const awayGoals = sampleNB(awayXG, rng);

    const homeEvents = homeXI.length>0 ? generateGoalEvents(homeXI, homeGoals, rng, true)  : [];
    const awayEvents = awayXI.length>0 ? generateGoalEvents(awayXI, awayGoals, rng, false) : [];
    const allEvents  = [...homeEvents, ...awayEvents].sort((a,b) => a.minute-b.minute);

    const homeWon = homeGoals > awayGoals;
    const awayWon = awayGoals > homeGoals;
    const draw    = homeGoals === awayGoals;

    const homeRatings = homeXI.length>0
      ? generateRatings(homeXI, homeEvents, rng, homeWon?true:draw?null:false) : {};
    const awayRatings = awayXI.length>0
      ? generateRatings(awayXI, awayEvents, rng, awayWon?true:draw?null:false) : {};
    const allRatings  = { ...homeRatings, ...awayRatings };

    const allXI = [...homeXI, ...awayXI];
    let motm = allXI[0]; let topR = -Infinity;
    for (const p of allXI) {
      const r = allRatings[p.id||p.name] || 6.0;
      if (r > topR) { topR = r; motm = p; }
    }

    const report = allEvents.map(ev => {
      const side  = ev.home ? homeClub.name : awayClub.name;
      const asst  = ev.assistant ? ` (${ev.assistant.name})` : '';
      return `${ev.minute}' ⚽ ${ev.scorer.name}${asst} — ${side}`;
    }).join('\n');

    return {
      home:       { id:homeId, name:homeClub.name, stadium:homeClub.stadium },
      away:       { id:awayId, name:awayClub.name },
      score:      { home:homeGoals, away:awayGoals },
      result:     homeWon?'home':awayWon?'away':'draw',
      xg:         { home:Math.round(homeXG*100)/100, away:Math.round(awayXG*100)/100 },
      teamScores: { home:homeScores, away:awayScores },
      xi:         { home:homeXI, away:awayXI },
      events:     allEvents,
      ratings:    allRatings,
      motm:       motm ? { id:motm.id, name:motm.name, rating:allRatings[motm.id||motm.name] } : null,
      report,
    };
  }

  // ─── SIMULATE ROUND ────────────────────────────────────────
  function simulateRound(fixtures, context={}) {
    return fixtures.map((fix, i) =>
      simulateMatch(fix.home, fix.away, {
        ...context,
        seed: context.seed != null ? context.seed + i*997 : null,
      })
    );
  }

  // ─── GENERATE FIXTURES (Round Robin) ───────────────────────
  function generateFixtures(clubs) {
    const list = [...clubs];
    if (list.length % 2 !== 0) list.push(null);
    const teams  = list.length;
    const rounds = teams-1;
    const fixtures = [];

    for (let r=0; r<rounds; r++) {
      for (let i=0; i<teams/2; i++) {
        const home = list[i], away = list[teams-1-i];
        if (home && away) fixtures.push({ round:r+1, home, away });
      }
      list.splice(1, 0, list.pop());
    }

    const returnFixtures = fixtures.map(f => ({
      round: f.round+rounds, home:f.away, away:f.home,
    }));

    return [...fixtures, ...returnFixtures];
  }

  // ─── STANDINGS ─────────────────────────────────────────────
  function calcStandings(results, clubIds) {
    const table = {};
    for (const id of clubIds) {
      table[id] = { id, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, pts:0 };
    }
    for (const r of results) {
      const h=r.home.id, a=r.away.id;
      if (!table[h]) table[h]={id:h,played:0,won:0,drawn:0,lost:0,gf:0,ga:0,gd:0,pts:0};
      if (!table[a]) table[a]={id:a,played:0,won:0,drawn:0,lost:0,gf:0,ga:0,gd:0,pts:0};
      const hg=r.score.home, ag=r.score.away;
      table[h].played++; table[h].gf+=hg; table[h].ga+=ag;
      table[a].played++; table[a].gf+=ag; table[a].ga+=hg;
      if (r.result==='home')      { table[h].won++; table[h].pts+=3; table[a].lost++; }
      else if (r.result==='away') { table[a].won++; table[a].pts+=3; table[h].lost++; }
      else                        { table[h].drawn++; table[h].pts++; table[a].drawn++; table[a].pts++; }
    }
    for (const row of Object.values(table)) row.gd = row.gf-row.ga;
    return Object.values(table).sort((a,b) => b.pts-a.pts||b.gd-a.gd||b.gf-a.gf);
  }

  // ─── FORME ─────────────────────────────────────────────────
  function updateForm(currentForm, result) {
    return [...(currentForm||[]), result].slice(-5);
  }

  // ─── BALLON D'OR ───────────────────────────────────────────
  function calcBallonDorScore(player, stats) {
    const pos = player.position;
    let score = 0;
    if (pos==='GK') {
      score = (stats.cleanSheets||0)*3.5 + (stats.saves||0)*0.3 +
              (stats.avgRating||6)*4.0   + (stats.matches||0)*0.5;
    } else if (['ST','LW','RW'].includes(pos)) {
      score = (stats.goals||0)*6.0   + (stats.assists||0)*3.5 +
              (stats.avgRating||6)*3.0 + (stats.matches||0)*0.5;
    } else if (['CAM','CM','CDM'].includes(pos)) {
      score = (stats.goals||0)*4.5   + (stats.assists||0)*4.5 +
              (stats.avgRating||6)*4.0 + (stats.matches||0)*0.5;
    } else {
      score = (stats.cleanSheets||0)*2.5  + (stats.tacklesWon||0)*0.5 +
              (stats.avgRating||6)*5.0    + (stats.matches||0)*0.5;
    }
    return Math.round(score*100)/100;
  }

  // ─── PUBLIC API ────────────────────────────────────────────
  return {
    simulateMatch,
    simulateRound,
    generateFixtures,
    calcStandings,
    updateForm,
    calcBallonDorScore,
    _selectStartingXI: selectStartingXI,
    _calcTeamScores:   calcTeamScores,
    _calcXG:           calcXG,
    _sampleNB:         sampleNB,
  };

})();

if (typeof module !== 'undefined') module.exports = MatchEngine;
