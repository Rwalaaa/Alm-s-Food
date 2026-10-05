// Mode cuisine : ingrédients ajustés aux portions, puis étapes une par une avec minuteurs.
// Plein écran par-dessus l'appli (pas dans #contenu), ouvert depuis la fiche d'une recette.
(function () {
  var h = App.h;
  var FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  var NE_CHANGENT_PAS = ['dos', 'gros', 'pois', 'bras', 'jus', 'riz', 'noix', 'à', 'de', 'd\'', 'du', 'des'];
  var et = null;          // état du mode cuisine ouvert (null = fermé)
  var verrou = null;      // écran maintenu allumé
  var audio = null;

  // ---------- Quantités ----------
  function lireNombre(s) {
    s = s.replace(',', '.');
    var m = s.match(/^(\d+(?:\.\d+)?)?\s*([¼½¾])?$/);
    if (!m || (!m[1] && !m[2])) return null;
    var v = m[1] ? parseFloat(m[1]) : 0;
    if (m[2]) v += { '¼': 0.25, '½': 0.5, '¾': 0.75 }[m[2]];
    return v;
  }
  // Grammes, cl… : arrondi utile en cuisine. Le reste (pièces, cuillères, boîtes) : au quart près.
  function ecrireNombre(v, unite) {
    if (unite) {
      var pas = unite === 'g' ? (v >= 250 ? 10 : v >= 20 ? 5 : 1) : (unite === 'kg' || unite === 'L' ? 0.1 : (v >= 10 ? 1 : 0.5));
      var r = Math.round(v / pas) * pas;
      if (r <= 0) r = pas;
      return String(+r.toFixed(2)).replace('.', ',');
    }
    var q = Math.round(v * 4) / 4;
    if (q <= 0) q = 0.25;
    var ent = Math.floor(q), frac = q - ent;
    if (!frac) return String(ent);
    return (ent ? ent + ' ' : '') + FRACTIONS[frac];
  }
  function avecUnite(v, u) {   // au-delà de 1 000 g : en kg (comme dans la liste de courses)
    if (u === 'g' && v >= 1000) { v /= 1000; u = 'kg'; }
    return ecrireNombre(v, u) + ' ' + u;
  }
  function accorder(mots, pluriel) {
    var stop = false;
    return mots.replace(/[A-Za-zÀ-ÿœ'.]+/g, function (mot) {
      if (stop) return mot;
      if (NE_CHANGENT_PAS.indexOf(mot.toLowerCase()) !== -1 || /\.$/.test(mot)) {
        if (/^(à|de|d'|du|des)$/i.test(mot) || /\.$/.test(mot)) stop = true;   // « c. à soupe » : on n'accorde rien
        return mot;
      }
      if (pluriel) return /[sx]$/i.test(mot) ? mot : /(au|eu)$/i.test(mot) ? mot + 'x' : mot + 's';
      return /[^s]s$/i.test(mot) && mot.length > 3 ? mot.slice(0, -1) : mot;
    });
  }
  // « 1 boîte (400 g) » × 1,5 → « 1 ½ boîte (600 g) » ; « quelques brins » reste tel quel
  function ajusterLibelle(libelle, facteur) {
    libelle = String(libelle == null ? '' : libelle);
    if (facteur === 1) return libelle;
    var m = libelle.match(/^\s*((?:\d+(?:[.,]\d+)?)?\s*[¼½¾]?)(?=\s|$)(.*)$/);
    if (!m || !m[1].trim()) return libelle;
    var v = lireNombre(m[1].trim());
    if (v === null) return libelle;
    var reste = m[2];
    var unite = (reste.match(/^\s*(g|kg|ml|cl|L|cm)\b/) || [])[1];
    var nv = v * facteur;
    var avant = v >= 2, apres = Math.round(nv * 4) / 4 >= 2;
    if (!unite && avant !== apres) {
      var p = reste.indexOf('(');
      reste = p === -1 ? accorder(reste, apres) : accorder(reste.slice(0, p), apres) + reste.slice(p);
    }
    reste = reste.replace(/\((\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|L)\)/, function (x, n, u) {
      return '(' + avecUnite(parseFloat(n.replace(',', '.')) * facteur, u) + ')';
    });
    if (unite) return avecUnite(nv, unite) + reste.replace(/^\s*\S+/, '');
    return ecrireNombre(nv) + reste;
  }

  function mmss(s) {
    s = Math.max(0, Math.ceil(s));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
  }

  // ---------- Minuteurs (calés sur l'horloge : justes même si le téléphone met l'appli en pause) ----------
  function maintenant() { return App.cuisine.horloge(); }
  function reste(t) {
    if (t.etat === 'marche') return Math.max(0, (t.fin - maintenant()) / 1000);
    if (t.etat === 'fini') return 0;
    return t.reste;
  }
  function minuteurDe(i) {
    var e = et.recette.etapes[i - 1];
    if (!e || !e.minuteur_s) return null;
    if (!et.minuteurs[i]) et.minuteurs[i] = { total: e.minuteur_s, reste: e.minuteur_s, etat: 'pret', fin: 0 };
    return et.minuteurs[i];
  }
  function actionMinuteur(i, action) {
    var t = minuteurDe(i);
    if (!t) return;
    debloquerSon();
    if (action === 'lancer') { t.fin = maintenant() + reste(t) * 1000; t.etat = 'marche'; }
    else if (action === 'pause') { t.reste = reste(t); t.etat = 'pause'; }
    else if (action === 'plus') {
      if (t.etat === 'marche') t.fin += 60000;
      else if (t.etat === 'fini') { t.fin = maintenant() + 60000; t.etat = 'marche'; arreterAlarme(i); }
      else t.reste += 60;
      t.total = Math.max(t.total, reste(t));
    }
    else if (action === 'zero') { t.etat = 'pret'; t.reste = et.recette.etapes[i - 1].minuteur_s; t.total = t.reste; arreterAlarme(i); }
    rendre();
  }
  function enMarche() {
    return Object.keys(et.minuteurs).filter(function (k) { return et.minuteurs[k].etat === 'marche'; });
  }

  // ---------- Alarme : vibration + bip, répétés jusqu'à « OK » (1 minute au plus) ----------
  function debloquerSon() {   // iPhone : le son doit être autorisé par un appui
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!audio && AC) audio = new AC();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }
  function bip() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) { /* */ }
    if (!audio) return;
    try {
      [0, 0.25, 0.5].forEach(function (d) {
        var o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + d;
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.start(t0); o.stop(t0 + 0.2);
      });
    } catch (e) { /* pas de son */ }
  }
  function arreterAlarme(i) {
    var k = et.alarmes.indexOf(Number(i));
    if (k !== -1) et.alarmes.splice(k, 1);
  }
  function verifierMinuteurs() {
    if (!et) return;
    var change = false;
    Object.keys(et.minuteurs).forEach(function (k) {
      var t = et.minuteurs[k];
      if (t.etat === 'marche' && reste(t) <= 0) {
        t.etat = 'fini'; t.sonneDepuis = maintenant(); t.dernierBip = 0;
        et.alarmes.push(Number(k)); change = true;
      }
    });
    et.alarmes.slice().forEach(function (k) {
      var t = et.minuteurs[k];
      if (maintenant() - t.sonneDepuis > 60000) return;
      if (maintenant() - t.dernierBip >= 2500) { t.dernierBip = maintenant(); bip(); }
    });
    if (change) rendre(); else majChiffres();
  }

  // ---------- Écran allumé ----------
  async function gererEcran() {
    var actif = !!et && document.visibilityState === 'visible';
    try {
      if (actif && !verrou && navigator.wakeLock) {
        verrou = await navigator.wakeLock.request('screen');
        verrou.addEventListener('release', function () { verrou = null; });
      } else if (!actif && verrou) {
        var v = verrou; verrou = null; await v.release();
      }
    } catch (e) { verrou = null; }
  }
  document.addEventListener('visibilitychange', function () {
    gererEcran();
    if (et && document.visibilityState === 'visible') verifierMinuteurs();
  });

  // ---------- Affichage ----------
  var RAYON = 54, TOUR = 2 * Math.PI * RAYON;
  function cadran(t) {
    var part = t.total ? reste(t) / t.total : 0;
    return '<svg class="cui-cadran" viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle cx="60" cy="60" r="' + RAYON + '" class="cui-piste"/>' +
      '<circle cx="60" cy="60" r="' + RAYON + '" class="cui-arc" stroke-dasharray="' + TOUR.toFixed(2) +
        '" stroke-dashoffset="' + (TOUR * (1 - part)).toFixed(2) + '" transform="rotate(-90 60 60)"/></svg>';
  }
  function boutonsMinuteur(i, t) {
    var b = function (action, texte, cls) {
      return '<button type="button" class="' + (cls || 'bouton secondaire') + '" data-minuteur="' + action + '" data-etape="' + i + '">' + texte + '</button>';
    };
    if (t.etat === 'pret') return b('lancer', 'Lancer le minuteur', 'bouton');
    if (t.etat === 'marche') return b('pause', 'Pause', 'bouton') + b('plus', '+ 1 min');
    if (t.etat === 'pause') return b('lancer', 'Reprendre', 'bouton') + b('zero', 'Remettre à zéro');
    return b('ok', 'OK', 'bouton') + b('plus', '+ 1 min');
  }
  function ecranIngredients() {
    var f = et.portions / (et.recette.portions || 1);
    var ingr = (et.recette.recette_ingredients || []).slice().sort(function (a, b) { return a.optionnel - b.optionnel; });
    return '<h2 class="cui-titre">Ingrédients</h2>' +
      '<p class="discret cui-aide">Touchez un ingrédient quand il est prêt sur le plan de travail.</p>' +
      '<ul class="cui-ingr">' + ingr.map(function (ri, k) {
        var pret = et.prets.indexOf(k) !== -1;
        return '<li><button type="button" class="cui-ingr-item" data-pret="' + k + '" aria-pressed="' + pret + '">' +
          '<span class="q">' + h(ajusterLibelle(ri.libelle_quantite || ri.quantite, f)) + '</span> ' +
          h(ri.ingredients ? ri.ingredients.nom : '?') +
          (ri.optionnel ? ' <span class="discret">(facultatif)</span>' : '') + '</button></li>';
      }).join('') + '</ul>';
  }
  function ecranEtape(i) {
    var e = et.recette.etapes[i - 1], t = minuteurDe(i);
    return '<p class="cui-numero">Étape ' + i + ' sur ' + et.recette.etapes.length + '</p>' +
      '<p class="cui-texte">' + h(e.texte) + '</p>' +
      (t ? '<div class="cui-minuteur" data-etat="' + t.etat + '">' + cadran(t) +
        '<p class="cui-temps" aria-live="polite">' + (t.etat === 'fini' ? 'C\'est prêt' : mmss(reste(t))) + '</p>' +
        '<div class="cui-boutons-min">' + boutonsMinuteur(i, t) + '</div></div>' : '');
  }
  function ecranFin() {
    var repas = et.options.repas;
    var noter = repas && !repas.cuisine_le;
    return '<div class="cui-fin"><h2 class="cui-titre">Bon appétit</h2>' +
      '<p class="discret">' + (repas && repas.cuisine_le ? 'Ce repas est noté comme cuisiné.' : 'Toutes les étapes sont faites.') + '</p>' +
      (noter ? '<button type="button" class="bouton" data-action="noter"' + (et.occupe ? ' disabled' : '') + '>Noter le repas comme cuisiné</button>' : '') +
      '<button type="button" class="bouton' + (noter ? ' secondaire' : '') + '" data-action="quitter">Quitter le mode cuisine</button>' +
      '<p class="erreur" role="alert"' + (et.erreur ? '' : ' hidden') + '>' + h(et.erreur || '') + '</p></div>';
  }
  // Repas du planning : on note le jour où il a été cuisiné
  async function noter() {
    var ici = et, repas = et.options.repas;
    if (!repas || repas.cuisine_le || ici.occupe) return;
    ici.occupe = true; ici.erreur = ''; rendre();
    var jour = App.dateISO(App.aujourdhui());
    var r = await ici.options.sb.from('planning').update({ cuisine_le: jour }).eq('id', repas.id);
    ici.occupe = false;
    if (r.error) {
      ici.erreur = App.traduireErreur(r.error);
      if (et === ici) rendre();
      return;
    }
    if (ici.options.quandCuisine) ici.options.quandCuisine(jour);
    else repas.cuisine_le = jour;
    if (et !== ici) return;
    rendre();
    quitter();
  }
  function rendre() {
    var c = et.el, n = et.recette.etapes.length, i = et.ecran;
    var actifs = Object.keys(et.minuteurs).filter(function (k) {
      var t = et.minuteurs[k]; return Number(k) !== i && (t.etat === 'marche' || t.etat === 'fini');
    });
    c.querySelector('.cui-portions output').textContent = et.portions;
    c.querySelector('[data-portions="-1"]').disabled = et.portions <= 1;
    c.querySelector('[data-portions="1"]').disabled = et.portions >= 20;
    c.querySelector('.cui-avance').style.width = (100 * i / (n + 1)) + '%';
    c.querySelector('.cui-corps').innerHTML = i === 0 ? ecranIngredients() : i <= n ? ecranEtape(i) : ecranFin();
    c.querySelector('.cui-autres').innerHTML = actifs.map(function (k) {
      var t = et.minuteurs[k];
      return '<button type="button" class="cui-puce" data-aller="' + k + '" data-etat="' + t.etat + '">Étape ' + k + ' · ' +
        '<span data-chrono="' + k + '">' + (t.etat === 'fini' ? 'prêt' : mmss(reste(t))) + '</span></button>';
    }).join('');
    c.querySelector('[data-nav="-1"]').disabled = i === 0;
    var suiv = c.querySelector('[data-nav="1"]');
    suiv.hidden = i > n;
    suiv.textContent = i === 0 ? (n ? 'Commencer' : 'Terminer') : i === n ? 'Terminer' : 'Étape suivante';
  }
  function majChiffres() {   // chaque seconde : seulement les chiffres et le cadran
    var c = et.el;
    var t = et.minuteurs[et.ecran], tps = c.querySelector('.cui-temps');
    if (t && tps && t.etat === 'marche') {
      tps.textContent = mmss(reste(t));
      var arc = c.querySelector('.cui-arc');
      if (arc) arc.setAttribute('stroke-dashoffset', (TOUR * (1 - reste(t) / t.total)).toFixed(2));
    }
    c.querySelectorAll('[data-chrono]').forEach(function (s) {
      var m = et.minuteurs[s.dataset.chrono];
      if (m && m.etat === 'marche') s.textContent = mmss(reste(m));
    });
  }

  // ---------- Ouvrir / fermer ----------
  function ouvrir(recette, portions, options) {
    if (et) return;
    var c = document.createElement('div');
    c.className = 'cuisine';
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'true');
    c.setAttribute('aria-label', 'Mode cuisine : ' + recette.titre);
    c.innerHTML =
      '<div class="vichy" aria-hidden="true"></div>' +
      '<header class="cui-entete">' +
        '<button type="button" class="cui-quitter" data-action="quitter" aria-label="Quitter le mode cuisine">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '<p class="cui-recette">' + h(recette.titre) + '</p>' +
        '<div class="cui-portions" role="group" aria-label="Portions">' +
          '<button type="button" data-portions="-1" aria-label="Une portion de moins">−</button>' +
          '<output aria-live="polite"></output>' +
          '<button type="button" data-portions="1" aria-label="Une portion de plus">+</button></div>' +
      '</header>' +
      '<div class="cui-barre" aria-hidden="true"><div class="cui-avance"></div></div>' +
      '<main class="cui-corps"></main>' +
      '<div class="cui-autres"></div>' +
      '<nav class="cui-nav">' +
        '<button type="button" class="bouton secondaire" data-nav="-1">Précédent</button>' +
        '<button type="button" class="bouton" data-nav="1"></button></nav>';
    et = { recette: recette, portions: portions || recette.portions || 1, ecran: 0, minuteurs: {}, alarmes: [], prets: [], el: c,
      options: options || {}, occupe: false, erreur: '',
      horloge: setInterval(verifierMinuteurs, 250) };
    if (!Array.isArray(recette.etapes)) recette.etapes = [];
    document.body.appendChild(c);
    document.documentElement.classList.add('cuisine-ouverte');
    c.addEventListener('click', clic);
    try { history.pushState({ cuisine: true, recette: recette.id }, ''); } catch (e) { /* sans historique */ }
    rendre();
    gererEcran();
    c.querySelector('.cui-quitter').focus();
  }
  function fermer() {
    if (!et) return;
    clearInterval(et.horloge);
    et.el.remove();
    et = null;
    document.documentElement.classList.remove('cuisine-ouverte');
    gererEcran();
  }
  function confirmerSortie() {
    var n = enMarche().length;
    return !n || window.confirm(n === 1 ? 'Un minuteur tourne encore. Quitter quand même ?' : n + ' minuteurs tournent encore. Quitter quand même ?');
  }
  function quitter() {
    if (!confirmerSortie()) return;
    if (history.state && history.state.cuisine) { et.sortieConfirmee = true; history.back(); }
    else fermer();
  }
  // Bouton retour du téléphone
  window.addEventListener('popstate', function () {
    if (!et || (history.state && history.state.cuisine)) return;
    if (et.sortieConfirmee || confirmerSortie()) return fermer();
    try { history.pushState({ cuisine: true, recette: et.recette.id }, ''); } catch (e) { /* */ }
  });

  function clic(e) {
    var b = e.target.closest('button');
    if (!b || b.disabled || !et) return;
    debloquerSon();
    var d = b.dataset;
    if (d.action === 'quitter') return quitter();
    if (d.action === 'noter') return noter();
    if (d.portions) { et.portions = Math.min(20, Math.max(1, et.portions + Number(d.portions))); return rendre(); }
    if (d.nav) {
      et.ecran = Math.min(et.recette.etapes.length + 1, Math.max(0, et.ecran + Number(d.nav)));
      rendre(); et.el.querySelector('.cui-corps').scrollTop = 0;
      return;
    }
    if (d.aller) { et.ecran = Number(d.aller); return rendre(); }
    if (d.pret !== undefined) {
      var k = Number(d.pret), p = et.prets.indexOf(k);
      if (p === -1) et.prets.push(k); else et.prets.splice(p, 1);
      return b.setAttribute('aria-pressed', String(p === -1));
    }
    if (d.minuteur === 'ok') {
      var i = Number(d.etape);
      arreterAlarme(i);
      et.minuteurs[i].etat = 'pret';
      et.minuteurs[i].reste = et.minuteurs[i].total = et.recette.etapes[i - 1].minuteur_s;
      return rendre();
    }
    if (d.minuteur) return actionMinuteur(Number(d.etape), d.minuteur);
  }

  App.cuisine = {
    ouvrir: ouvrir,
    fermer: fermer,
    ouvert: function () { return !!et; },
    ajusterLibelle: ajusterLibelle,
    mmss: mmss,
    horloge: function () { return Date.now(); }   // remplaçable en test
  };
  App.ouvrirCuisine = ouvrir;
})();
