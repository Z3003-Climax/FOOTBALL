// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — cle.js
// Bloc 5 : Champions League Equestria — Bracket complet
// ═══════════════════════════════════════════════════════════════
//
// CORRECTION v2 :
//   - tickCLE(state, canon) → avance UNE phase à la fois
//   - État: 'idle' → 'qual_r1' → 'qual_r2' → 'qual_r3' → 'qual_r4'
//           → 'league' → 'playoff' → 'r16' → 'qf' → 'sf' → 'final'
//           → 'complete'
//   - runFullCLE conservé pour compatibilité
//
// ───────────────────────────────────────────────────────────────

'use strict';

const CLEEngine = (() => {

  const TIER_COEF = { top: 4, fort: 3, moyen: 2, faible: 1 };

  const DIRECT_CLUBS = [
    'BAYERN_ILUMYSS','FAIRY_TAIL','OLFRA_KE_CONGERE','PORT_YONEUVE',
    'BRISBANE_ROAR','BLACKS_CLOVER',
    'JUVENTUS_EARTH','BOURRUSIA_BOUVILLE','GEARS_PONEYS',
    'WONDER_BALLT','SSC_NESERT_WERT','FENERBACHE_CLOBSDEL',
    'FENRIR','FC_ZANZIBAR',
    'BERU_FC','FC_HYDRA','RC_MARI_TUGA',
    'AJAX_FARWEST','HOLE_GEULCH_MI_ROSA','BRESIL_FC',
    'GALAXYS_PARIS','ETOILE_ROUGE_BLASE','SUPA_STRIKA',
    'SHADOW_BALLT',
  ];

  // Séquence des phases — utilisée par tickCLE
  const PHASE_SEQUENCE = [
    'idle','qual_r1','qual_r2','qual_r3','qual_r4',
    'league','playoff','r16','qf','sf','final','complete',
  ];

  // ─── UTILS ────────────────────────────────────────────────
  function shuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function seededRNG(seed) {
    let s = seed >>> 0;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ─── INIT CLE ─────────────────────────────────────────────
  function initCLE(canon, season) {
    const rng  = seededRNG(season.seed + 88888);
    const allClubs = Object.values(canon.clubs);

    const qualClubs = allClubs
      .filter(c => !DIRECT_CLUBS.includes(c.id))
      .sort((a, b) => (TIER_COEF[b.tier]||1) - (TIER_COEF[a.tier]||1));

    const entrants = qualClubs.slice(0, 120);

    const sorted = [...entrants];
    const bR3 = shuffle(sorted.slice(0, 16), rng);
    const bR2 = shuffle(sorted.slice(16, 40), rng);
    const r1  = shuffle(sorted.slice(40), rng);

    return {
      phase:       'idle',
      year:        season.year,
      baseSeed:    season.seed + 77777,
      directClubs: DIRECT_CLUBS,
      entrants:    entrants.map(c => c.id),
      qualRounds: {
        r1: { clubs: r1.map(c=>c.id),  byes: [],               results: [], qualified: [] },
        r2: { clubs: [],                byes: bR2.map(c=>c.id), results: [], qualified: [] },
        r3: { clubs: [],                byes: bR3.map(c=>c.id), results: [], qualified: [] },
        r4: { clubs: [],                byes: [],               results: [], qualified: [] },
      },
      leaguePhase:      null,
      knockout:         { playoff:null, r16:null, qf:null, sf:null, final:null },
      knockoutBracket:  [], // équipes restantes en knockout
      winner:           null,
    };
  }

  // ─── TICK CLE — avance UNE phase ──────────────────────────
  // Retourne le nouvel état CLE après avoir joué la prochaine phase
  function tickCLE(cle, canon) {
    if (cle.phase === 'complete') return cle;

    const currentIdx = PHASE_SEQUENCE.indexOf(cle.phase);
    if (currentIdx === -1) return cle;

    const nextPhase = PHASE_SEQUENCE[currentIdx + 1];
    const updated   = JSON.parse(JSON.stringify(cle)); // deep clone

    switch (nextPhase) {
      case 'qual_r1': return _runQualR1(updated, canon);
      case 'qual_r2': return _runQualR2(updated, canon);
      case 'qual_r3': return _runQualR3(updated, canon);
      case 'qual_r4': return _runQualR4(updated, canon);
      case 'league':  return _runLeague(updated, canon);
      case 'playoff': return _runPlayoff(updated, canon);
      case 'r16':     return _runR16(updated, canon);
      case 'qf':      return _runQF(updated, canon);
      case 'sf':      return _runSF(updated, canon);
      case 'final':   return _runFinal(updated, canon);
      default:        return updated;
    }
  }

  // ─── PHASE HANDLERS ───────────────────────────────────────

  function _runQualR1(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 1001);
    cle.qualRounds.r1 = _simulateQualRound(cle.qualRounds.r1, canon, rng);
    cle.phase = 'qual_r1';
    return cle;
  }

  function _runQualR2(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 2002);
    cle.qualRounds.r2.clubs = cle.qualRounds.r1.qualified;
    cle.qualRounds.r2 = _simulateQualRound(cle.qualRounds.r2, canon, rng);
    cle.phase = 'qual_r2';
    return cle;
  }

  function _runQualR3(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 3003);
    cle.qualRounds.r3.clubs = cle.qualRounds.r2.qualified;
    cle.qualRounds.r3 = _simulateQualRound(cle.qualRounds.r3, canon, rng);
    cle.phase = 'qual_r3';
    return cle;
  }

  function _runQualR4(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 4004);
    cle.qualRounds.r4.clubs = cle.qualRounds.r3.qualified;
    cle.qualRounds.r4.byes  = [];
    cle.qualRounds.r4 = _simulateQualRound(cle.qualRounds.r4, canon, rng);
    cle.phase = 'qual_r4';
    return cle;
  }

  function _runLeague(cle, canon) {
    const qualifiedClubs = cle.qualRounds.r4.qualified.slice(0, 12);
    cle.leaguePhase = _buildLeaguePhase(cle, qualifiedClubs, canon);
    cle.phase = 'league';
    return cle;
  }

  function _runPlayoff(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 6006);
    const res = _runKnockoutRound(cle.leaguePhase.playoffTeams, canon, rng, true);
    cle.knockout.playoff = res;
    cle.knockoutBracket  = [...cle.leaguePhase.directR16, ...res.winners];
    cle.phase = 'playoff';
    return cle;
  }

  function _runR16(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 7007);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, true);
    cle.knockout.r16    = res;
    cle.knockoutBracket = res.winners;
    cle.phase = 'r16';
    return cle;
  }

  function _runQF(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 8008);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, true);
    cle.knockout.qf     = res;
    cle.knockoutBracket = res.winners;
    cle.phase = 'qf';
    return cle;
  }

  function _runSF(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 9009);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, true);
    cle.knockout.sf     = res;
    cle.knockoutBracket = res.winners;
    cle.phase = 'sf';
    return cle;
  }

  function _runFinal(cle, canon) {
    const rng = seededRNG(cle.baseSeed + 9999);
    const res = _runKnockoutRound(cle.knockoutBracket, canon, rng, false, true);
    cle.knockout.final  = res;
    cle.winner          = res.winners[0] || null;
    cle.phase           = 'complete';
    return cle;
  }

  // ─── QUAL ROUND SIMULATOR ────────────────────────────────
  function _simulateQualRound(round, canon, rng) {
    const byes   = round.byes || [];
    const shuffled = shuffle([...round.clubs], rng);
    const results  = [];
    const qualified = [...byes];

    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 >= shuffled.length) continue;
      const home = shuffled[i];
      const away = shuffled[i + 1];

      const leg1 = MatchEngine.simulateMatch(home, away, {
        canon, seed: rng() * 100000 | 0,
      });
      const leg2 = MatchEngine.simulateMatch(away, home, {
        canon, seed: rng() * 100000 | 0,
      });

      const agg_home = leg1.score.home + leg2.score.away;
      const agg_away = leg1.score.away + leg2.score.home;
      const winner   = agg_home > agg_away ? home
                     : agg_away > agg_home ? away
                     : (rng() < 0.5 ? home : away);

      results.push({
        home, away,
        leg1: { home: leg1.score.home, away: leg1.score.away },
        leg2: { home: leg2.score.away, away: leg2.score.home },
        agg:  { home: agg_home, away: agg_away },
        winner,
      });
      qualified.push(winner);
    }

    return { ...round, results, qualified };
  }

  // ─── LEAGUE PHASE ────────────────────────────────────────
  function _buildLeaguePhase(cle, qualifiedClubs, canon) {
    const rng = seededRNG(cle.baseSeed + 5555);
    const allClubs = [...cle.directClubs, ...qualifiedClubs].slice(0, 36);

    const fixtures  = [];
    const matchCount = {};
    for (const c of allClubs) {
      matchCount[c] = { home:0, away:0, total:0, opponents: new Set() };
    }
    const shuffled = shuffle(allClubs, rng);
    let attempts = 0;

    while (fixtures.length < 36 * 4 && attempts < 5000) {
      attempts++;
      const eligible  = shuffled.filter(c => matchCount[c].total < 8);
      if (eligible.length < 2) break;
      const homePool  = eligible.filter(c => matchCount[c].home < 4);
      const awayPool  = eligible.filter(c => matchCount[c].away < 4);
      if (!homePool.length || !awayPool.length) break;

      const home = homePool[Math.floor(rng() * homePool.length)];
      const awayEligible = awayPool.filter(c =>
        c !== home && !matchCount[home].opponents.has(c)
      );
      if (!awayEligible.length) continue;
      const away = awayEligible[Math.floor(rng() * awayEligible.length)];

      fixtures.push({ home, away });
      matchCount[home].home++; matchCount[home].total++;
      matchCount[away].away++; matchCount[away].total++;
      matchCount[home].opponents.add(away);
      matchCount[away].opponents.add(home);
    }

    const results   = [];
    const standings = {};
    for (const c of allClubs) {
      standings[c] = { id:c, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, pts:0 };
    }

    for (const fix of fixtures) {
      const m = MatchEngine.simulateMatch(fix.home, fix.away, {
        canon, seed: rng() * 1000000 | 0,
      });
      results.push({ home:fix.home, away:fix.away, score:m.score, result:m.result, motm:m.motm });

      const h = standings[fix.home];
      const a = standings[fix.away];
      h.played++; h.gf += m.score.home; h.ga += m.score.away; h.gd = h.gf - h.ga;
      a.played++; a.gf += m.score.away; a.ga += m.score.home; a.gd = a.gf - a.ga;
      if (m.result === 'home')      { h.won++; h.pts += 3; a.lost++; }
      else if (m.result === 'away') { a.won++; a.pts += 3; h.lost++; }
      else                          { h.drawn++; h.pts++; a.drawn++; a.pts++; }
    }

    const table = Object.values(standings)
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

    return {
      clubs:        allClubs,
      fixtures,
      results,
      standings:    table,
      directR16:    table.slice(0, 8).map(r => r.id),
      playoffTeams: table.slice(8, 24).map(r => r.id),
      eliminated:   table.slice(24).map(r => r.id),
    };
  }

  // ─── KNOCKOUT ROUND ──────────────────────────────────────
  function _runKnockoutRound(clubs, canon, rng, twoLegs=true, neutral=false) {
    const pairs   = [];
    const shuffled = shuffle([...clubs], rng);
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) pairs.push({ home: shuffled[i], away: shuffled[i+1] });
    }

    const results = [];
    const winners = [];

    for (const pair of pairs) {
      if (twoLegs) {
        const leg1 = MatchEngine.simulateMatch(pair.home, pair.away, { canon, seed: rng()*1000000|0 });
        const leg2 = MatchEngine.simulateMatch(pair.away, pair.home, { canon, seed: rng()*1000000|0 });
        const agg_h = leg1.score.home + leg2.score.away;
        const agg_a = leg1.score.away + leg2.score.home;
        const winner = agg_h > agg_a ? pair.home : agg_a > agg_h ? pair.away : (rng()<0.5?pair.home:pair.away);
        results.push({ home:pair.home, away:pair.away,
          leg1: leg1.score,
          leg2: { home: leg2.score.away, away: leg2.score.home },
          agg:  { home: agg_h, away: agg_a },
          winner });
        winners.push(winner);
      } else {
        const m = MatchEngine.simulateMatch(pair.home, pair.away, { canon, seed: rng()*1000000|0, neutral });
        const winner = m.result==='home' ? pair.home : m.result==='away' ? pair.away : (rng()<0.5?pair.home:pair.away);
        results.push({ home:pair.home, away:pair.away, score:m.score, winner, motm:m.motm });
        winners.push(winner);
      }
    }
    return { results, winners };
  }

  // ─── RUN FULL CLE (compatibilité) ────────────────────────
  function runFullCLE(canon, season) {
    let cle = initCLE(canon, season);
    const phases = ['qual_r1','qual_r2','qual_r3','qual_r4','league','playoff','r16','qf','sf','final'];
    for (const _ of phases) {
      cle = tickCLE(cle, canon);
    }
    return cle;
  }

  // ─── PHASE LABEL (pour l'UI) ─────────────────────────────
  function getPhaseLabel(phase) {
    const labels = {
      idle:     'Prêt à lancer',
      qual_r1:  'Tour de qualification 1',
      qual_r2:  'Tour de qualification 2',
      qual_r3:  'Tour de qualification 3',
      qual_r4:  'Barrages de qualification',
      league:   'Phase de ligue',
      playoff:  'Barrages knockout',
      r16:      'Huitièmes de finale',
      qf:       'Quarts de finale',
      sf:       'Demi-finales',
      final:    'Finale',
      complete: 'Terminée',
    };
    return labels[phase] || phase;
  }

  function getNextPhaseLabel(phase) {
    const idx = PHASE_SEQUENCE.indexOf(phase);
    if (idx === -1 || idx >= PHASE_SEQUENCE.length - 2) return null;
    return getPhaseLabel(PHASE_SEQUENCE[idx + 1]);
  }

  // ─── FORMAT HELPERS ───────────────────────────────────────
  function getClubName(id, canon) {
    return canon.clubs[id]?.name || id;
  }

  function formatQualResults(round, canon) {
    return (round.results || []).map(r => ({
      home:   getClubName(r.home, canon),
      away:   getClubName(r.away, canon),
      leg1:   `${r.leg1.home}-${r.leg1.away}`,
      leg2:   `${r.leg2.home}-${r.leg2.away}`,
      agg:    `${r.agg.home}-${r.agg.away}`,
      winner: getClubName(r.winner, canon),
    }));
  }

  // ─── PUBLIC ───────────────────────────────────────────────
  return {
    initCLE,
    tickCLE,
    runFullCLE,
    getPhaseLabel,
    getNextPhaseLabel,
    getClubName,
    formatQualResults,
    DIRECT_CLUBS,
    PHASE_SEQUENCE,
  };

})();

if (typeof module !== 'undefined') module.exports = CLEEngine;
