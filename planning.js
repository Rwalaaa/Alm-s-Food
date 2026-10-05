// Onglet Planning : la semaine, midi et soir
(function () {
  var h = App.h;
  var JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MOMENTS = [['midi', 'Midi'], ['soir', 'Soir']];
  var HISTORIQUE_SEMAINES = 4;

  // ---------- Dates (heure locale, jamais UTC) ----------
  function deux(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate()); }
  function lundiDe(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - (x.getDay() + 6) % 7);
    return x;
  }
  function plusJours(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  App.dateISO = iso;
  App.lundiDe = lundiDe;
  App.aujourdhui = function () { return new Date(); };   // remplaçable dans les tests

  function titreSemaine(lundi) {
    var dim = plusJours(lundi, 6);
    if (lundi.getMonth() === dim.getMonth()) return 'Du ' + lundi.getDate() + ' au ' + dim.getDate() + ' ' + MOIS[dim.getMonth()];
    return 'Du ' + lundi.getDate() + ' ' + MOIS[lundi.getMonth()] + ' au ' + dim.getDate() + ' ' + MOIS[dim.getMonth()];
  }

  var etat = { lundi: null, repas: [], recettes: [], parId: {}, choix: null, texte: '', erreur: '', occupe: false, froid: false, recents: {},
    ingParNom: {}, ouvert: null };
  var CHAMPS = 'id, jour, moment, recette_id, portions, reste_de, froid, ingredients_retires, cuisine_le';

  function lundiCourant() { return lundiDe(App.aujourdhui()); }
  function semainePassee() { return etat.lundi < lundiCourant(); }
  function lundiMin() { return plusJours(lundiCourant(), -7 * HISTORIQUE_SEMAINES); }

  async function chargerSemaine(sb) {
    var r = await sb.from('planning')
      .select(CHAMPS)
      .gte('jour', iso(plusJours(etat.lundi, -1))).lte('jour', iso(plusJours(etat.lundi, 7)))   // ±1 jour : liens soir / restes
      .order('cree_le');
    if (r.error) throw r.error;
    etat.repas = r.data || [];
  }

  // ---------- Vue semaine ----------
  function rendreSemaine(c, ctx) {
    var passee = semainePassee();
    var auj = iso(App.aujourdhui());
    var html =
      '<div class="sem-nav">' +
        '<button type="button" class="sem-fleche" data-sens="-1" aria-label="Semaine précédente"' + (etat.lundi <= lundiMin() ? ' disabled' : '') + '>‹</button>' +
        '<div class="sem-titre"><span>' + titreSemaine(etat.lundi) + '</span>' +
          (iso(etat.lundi) === iso(lundiCourant()) ? '<small>Cette semaine</small>' : passee ? '<small>Historique, en lecture seule</small>' : '') + '</div>' +
        '<button type="button" class="sem-fleche" data-sens="1" aria-label="Semaine suivante">›</button>' +
      '</div>' +
      (etat.erreur ? '<p class="erreur bandeau" role="alert">' + h(etat.erreur) + '</p>' : '') +
      '<ol class="jours">';
    for (var j = 0; j < 7; j++) {
      var d = plusJours(etat.lundi, j), di = iso(d);
      html += '<li class="jour' + (di === auj ? ' aujourdhui' : '') + '"><h2>' + JOURS[j] + ' ' + d.getDate() + '</h2>';
      MOMENTS.forEach(function (m) {
        var plats = etat.repas.filter(function (p) { return p.jour === di && p.moment === m[0]; });
        html += '<div class="creneau"><span class="moment">' + m[1] + '</span><div class="plats">' +
          plats.map(function (p) { return carte(p, passee); }).join('') +
          (passee ? (plats.length ? '' : '<span class="vide-creneau">Rien de noté</span>')
                  : '<button type="button" class="ajouter' + (plats.length ? ' ajouter-autre' : '') + '" data-jour="' + di + '" data-moment="' + m[0] + '">' +
                      (plats.length ? 'Autre plat' : 'Ajouter un plat') + '</button>') +
          '</div></div>';
      });
      html += '</li>';
    }
    c.innerHTML = html + '</ol>';

    c.querySelectorAll('.sem-fleche').forEach(function (b) {
      b.addEventListener('click', async function () {
        etat.lundi = plusJours(etat.lundi, 7 * Number(b.dataset.sens));
        etat.erreur = '';
        await recharger(c, ctx);
      });
    });
    c.querySelectorAll('.ajouter').forEach(function (b) {
      b.addEventListener('click', function () {
        etat.choix = { jour: b.dataset.jour, moment: b.dataset.moment };
        etat.texte = '';
        rendreChoix(c, ctx);
      });
    });
    c.querySelectorAll('.plat').forEach(function (el) {
      var id = el.dataset.id;
      el.querySelectorAll('[data-action]').forEach(function (b) {
        b.addEventListener('click', function () { action(c, ctx, id, b.dataset.action); });
      });
      el.querySelectorAll('[data-ingr]').forEach(function (k) {
        k.addEventListener('change', function () { basculerIngredient(c, ctx, id, k.dataset.ingr, k.checked); });
      });
    });
  }

  function carte(p, lectureSeule) {
    var r = etat.parId[p.recette_id];
    var estReste = !!p.reste_de;
    var aDesRestes = !estReste && etat.repas.some(function (x) { return x.reste_de === p.id; });
    var badges = (estReste ? '<span class="badge">Restes de la veille</span>' : '') +
      (p.froid ? '<span class="badge badge-froid">Froid</span>' : '') +
      (aDesRestes ? '<span class="badge">Restes pour demain midi</span>' : '') +
      (p.cuisine_le && !estReste ? '<span class="badge">Cuisiné</span>' : '');
    return '<div class="plat' + (estReste ? ' plat-reste' : '') + '" data-id="' + h(p.id) + '">' +
      '<span class="plat-titre">' + h(r ? r.titre : 'Recette supprimée') + '</span>' +
      (badges ? '<span class="badges">' + badges + '</span>' : '') +
      (lectureSeule ? '<span class="plat-portions">' + p.portions + ' pers.</span>' :
      '<div class="plat-actions">' +
        '<button type="button" data-action="moins" aria-label="Une portion de moins"' + (p.portions <= 1 ? ' disabled' : '') + '>−</button>' +
        '<span class="plat-portions">' + p.portions + ' pers.</span>' +
        '<button type="button" data-action="plus" aria-label="Une portion de plus"' + (p.portions >= 20 ? ' disabled' : '') + '>+</button>' +
        '<button type="button" data-action="retirer" class="retirer" aria-label="Retirer ce plat">Retirer</button>' +
      '</div>' +
      (r && !estReste && App.ouvrirCuisine ? '<button type="button" data-action="cuisiner" class="plat-restes">Cuisiner pas à pas</button>' : '') +
      (p.moment === 'soir' && !estReste && !aDesRestes
        ? '<button type="button" data-action="restes" class="plat-restes">Garder des restes pour demain midi</button>' : '') +
      (estReste || !r ? '' : panneauIngredients(p, r))) +
    '</div>';
  }

  // Ingrédients d'un repas : décocher ce qu'on a déjà, il ne sera pas acheté pour ce repas (ingredients_retires)
  function ingredientsDe(r) {
    return (r.recette_ingredients || []).filter(function (ri) { return !ri.optionnel && ri.ingredients && etat.ingParNom[ri.ingredients.nom]; })
      .map(function (ri) { return etat.ingParNom[ri.ingredients.nom]; });
  }
  function panneauIngredients(p, r) {
    var ings = ingredientsDe(r);
    if (!ings.length) return '';
    var retires = p.ingredients_retires || [];
    var n = ings.filter(function (i) { return retires.indexOf(i.id) !== -1; }).length;
    var ouvert = etat.ouvert === p.id;
    var html = '<button type="button" data-action="ingredients" class="plat-restes plat-ingr-bascule" aria-expanded="' + ouvert + '">' +
      (ouvert ? 'Masquer les ingrédients' : 'Ingrédients' + (n ? ' (' + n + ' déjà là)' : '')) + '</button>';
    if (!ouvert) return html;
    return html + '<div class="plat-ingr"><p>Décoche ce que vous avez déjà : ce ne sera pas acheté pour ce repas.</p><ul>' +
      ings.map(function (i) {
        var garde = retires.indexOf(i.id) === -1;
        return '<li><label class="' + (garde ? '' : 'deja-la') + '"><input type="checkbox" data-ingr="' + h(i.id) + '"' + (garde ? ' checked' : '') + '>' +
          '<span>' + h(i.nom) + '</span>' + (garde ? '' : '<small>déjà là</small>') + '</label></li>';
      }).join('') + '</ul></div>';
  }

  // Un plat « restes » ne compte pas dans les courses : ce sont les portions du soir qui portent tout.
  // Donc ajouter, modifier ou retirer des restes ajuste aussi les portions du repas du soir.
  function borne(n) { return Math.min(20, Math.max(1, n)); }

  async function majPortions(sb, ligne, n) {
    var r = await sb.from('planning').update({ portions: n }).eq('id', ligne.id);
    if (!r.error) ligne.portions = n;
    return r;
  }

  // Mode cuisine depuis un repas : portions prévues, et « Noter le repas comme cuisiné » à la fin
  function cuisiner(c, ctx, id) {
    var p = etat.repas.find(function (x) { return x.id === id; });
    var r = p && etat.parId[p.recette_id];
    if (!r) return;
    App.ouvrirCuisine(r, p.portions, { repas: p, sb: ctx.sb, quandCuisine: function (jour) {
      p.cuisine_le = jour;
      if (c.isConnected && document.querySelector('.onglet[data-onglet="planning"][aria-current="page"]') && !etat.choix) rendreSemaine(c, ctx);
    } });
  }

  async function action(c, ctx, id, quoi) {
    if (quoi === 'ingredients') { etat.ouvert = etat.ouvert === id ? null : id; return rendreSemaine(c, ctx); }
    if (quoi === 'cuisiner') return cuisiner(c, ctx, id);
    if (etat.occupe) return;
    var p = etat.repas.find(function (x) { return x.id === id; });
    if (!p) return;
    var parent = p.reste_de ? etat.repas.find(function (x) { return x.id === p.reste_de; }) : null;
    etat.occupe = true;
    var r = {};
    if (quoi === 'restes') {
      var n = Math.max(1, ctx.membres.length || 2);
      var lendemain = iso(plusJours(new Date(p.jour + 'T12:00:00'), 1));
      r = await ctx.sb.from('planning')
        .insert({ jour: lendemain, moment: 'midi', recette_id: p.recette_id, portions: n, reste_de: p.id, froid: false })
        .select(CHAMPS).single();
      if (!r.error) {
        etat.repas.push(r.data);
        r = await majPortions(ctx.sb, p, borne(p.portions + n));
      }
    } else if (quoi === 'retirer') {
      r = await ctx.sb.from('planning').delete().eq('id', id);
      if (!r.error) {
        // les restes d'un plat du soir partent avec lui (suppression en cascade dans la base)
        etat.repas = etat.repas.filter(function (x) { return x.id !== id && x.reste_de !== id; });
        if (parent) r = await majPortions(ctx.sb, parent, borne(parent.portions - p.portions));
      }
    } else {
      var avant = p.portions, apres = borne(p.portions + (quoi === 'plus' ? 1 : -1));
      r = await majPortions(ctx.sb, p, apres);
      if (!r.error && parent && apres !== avant) r = await majPortions(ctx.sb, parent, borne(parent.portions + apres - avant));
    }
    etat.occupe = false;
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    if (c.isConnected) rendreSemaine(c, ctx);
  }

  async function basculerIngredient(c, ctx, id, ingId, garde) {
    var p = etat.repas.find(function (x) { return x.id === id; });
    if (!p || etat.occupe) { if (c.isConnected) rendreSemaine(c, ctx); return; }
    var avant = p.ingredients_retires || [];
    var apres = avant.filter(function (x) { return x !== ingId; });
    if (!garde) apres.push(ingId);
    etat.occupe = true;
    var r = await ctx.sb.from('planning').update({ ingredients_retires: apres }).eq('id', id);
    etat.occupe = false;
    if (!r.error) p.ingredients_retires = apres;
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    if (document.querySelector('.onglet[data-onglet="planning"][aria-current="page"]') && !etat.choix) rendreSemaine(c, ctx);
  }

  // ---------- Choix d'une recette ----------
  function joursEntre(a, b) {   // dates "AAAA-MM-JJ", b - a en jours
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  }
  function texteRecent(j) {
    if (j === 0) return 'Déjà au menu ce jour-là';
    if (j === 1) return 'Au menu la veille';
    return 'Au menu il y a ' + j + ' jours';
  }

  async function chargerRecents(sb, jour) {
    // Plats des 4 dernières semaines avant ce repas : signalés et placés en fin de liste
    etat.recents = {};
    var debut = iso(plusJours(new Date(jour + 'T12:00:00'), -7 * HISTORIQUE_SEMAINES));
    var r = await sb.from('planning').select('recette_id, jour').gte('jour', debut).lte('jour', jour);
    if (r.error) return;   // pas bloquant
    (r.data || []).forEach(function (l) {
      var j = joursEntre(l.jour, jour);
      if (etat.recents[l.recette_id] === undefined || j < etat.recents[l.recette_id]) etat.recents[l.recette_id] = j;
    });
  }

  function rendreChoix(c, ctx) {
    var ch = etat.choix;
    var d = new Date(ch.jour + 'T12:00:00');
    etat.froid = false;
    c.innerHTML =
      '<button type="button" class="retour">Annuler</button>' +
      '<h2 class="choix-titre">' + JOURS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ', ' + (ch.moment === 'midi' ? 'le midi' : 'le soir') + '</h2>' +
      '<input type="search" class="rec-recherche choix-recherche" placeholder="Plat ou ingrédient" aria-label="Chercher une recette">' +
      (ch.moment === 'midi'
        ? '<label class="choix-froid"><input type="checkbox"> Pas de micro-ondes ce midi : seulement les plats qui se mangent froids</label>' : '') +
      '<p class="erreur" role="alert" hidden></p>' +
      '<ul class="rec-liste choix-liste"><li class="rec-aucune">Chargement…</li></ul>';
    var liste = c.querySelector('.choix-liste');
    var pret = false;
    function maj() {
      if (!pret) return;
      var t = App.simplifier(etat.texte.trim());
      var res = etat.recettes.filter(function (r) {
        return (!t || r._cherche.indexOf(t) !== -1) && (!etat.froid || r.se_mange_froid);
      });
      var recent = function (r) { var j = etat.recents[r.id]; return j !== undefined && j <= 7; };
      // Ordre : plats de saison, puis les autres, puis hors saison ; les plats récents toujours en fin de liste
      var mois = d.getMonth() + 1;
      var rang = function (r) {
        if (!App.saison) return 1;
        var s = App.saison(r, mois);
        return (recent(r) ? 3 : 0) + (s.hors.length ? 2 : s.deSaison ? 0 : 1);
      };
      // Anti-gaspi d'abord : plus il y a d'ingrédients déjà au placard, plus le plat remonte (les récents restent en fin)
      var placard = function (r) { return App.auPlacard ? App.auPlacard(r, etat.placard).length : 0; };
      // Goûts (14b) : un plat que quelqu'un n'aime pas passe en fin (avant les récents) ; un plat aimé gagne une place à saison égale
      var gouts = function (r) { return App.goutsRecette ? App.goutsRecette(r, etat.gouts) : { pas: [], aimes: [] }; };
      res = res.map(function (r, k) {
        var g = gouts(r);
        return { r: r, k: k, n: rang(r), p: recent(r) ? 0 : placard(r), rec: recent(r) ? 1 : 0, pas: g.pas.length ? 1 : 0, aime: g.aimes.length ? 1 : 0 };
      })
        .sort(function (a, b) { return a.rec - b.rec || a.pas - b.pas || b.p - a.p || a.n - b.n || b.aime - a.aime || a.k - b.k; }).map(function (x) { return x.r; });
      liste.innerHTML = res.length ? res.map(function (r) {
        var j = etat.recents[r.id];
        return '<li><button type="button" class="rec-item" data-id="' + h(r.id) + '"><span class="rec-titre">' + h(r.titre) + '</span>' +
          '<span class="rec-infos"><span>' + (r.temps_prep_min + r.temps_cuisson_min) + ' min</span><span>' + r._nutri.kcal + ' kcal</span>' +
          (App.mentionSaison ? App.mentionSaison(r, d.getMonth() + 1) : '') +
          (App.mentionPlacard ? App.mentionPlacard(r, etat.placard) : '') +
          (App.mentionGouts ? App.mentionGouts(r, etat.gouts) : '') +
          (j !== undefined ? '<span class="recent">' + texteRecent(j) + '</span>' : '') + '</span></button></li>';
      }).join('') : '<li class="rec-aucune">Aucune recette ne correspond.</li>';
    }
    c.querySelector('.retour').addEventListener('click', function () { etat.choix = null; rendreSemaine(c, ctx); });
    c.querySelector('.choix-recherche').addEventListener('input', function (e) { etat.texte = e.target.value; maj(); });
    var caseFroid = c.querySelector('.choix-froid input');
    if (caseFroid) caseFroid.addEventListener('change', function () { etat.froid = caseFroid.checked; maj(); });
    liste.addEventListener('click', async function (e) {
      var b = e.target.closest('.rec-item');
      if (!b || etat.occupe) return;
      etat.occupe = true;
      b.disabled = true;
      var r = await ctx.sb.from('planning')
        .insert({ jour: ch.jour, moment: ch.moment, recette_id: b.dataset.id, portions: Math.max(1, ctx.membres.length || 2), froid: etat.froid })
        .select(CHAMPS).single();
      etat.occupe = false;
      if (r.error) {
        b.disabled = false;
        var p = c.querySelector('.erreur'); p.textContent = App.traduireErreur(r.error); p.hidden = false;
        return;
      }
      etat.repas.push(r.data);
      etat.choix = null;
      etat.erreur = '';
      if (c.isConnected) rendreSemaine(c, ctx);
    });
    window.scrollTo(0, 0);
    etat.placard = {};
    var placard = App.chargerPlacard ? App.chargerPlacard(ctx.sb).then(function (p) { etat.placard = p; }, function () { /* pas bloquant */ }) : null;
    etat.gouts = {};
    var gouts = App.chargerGouts ? App.chargerGouts(ctx.sb).then(function (g) { etat.gouts = g; }, function () { /* pas bloquant */ }) : null;
    Promise.all([chargerRecents(ctx.sb, ch.jour), placard, gouts]).then(function () { pret = true; if (c.isConnected) maj(); });
  }

  // ---------- Chargement ----------
  async function recharger(c, ctx) {
    c.innerHTML = '<p class="chargement">Chargement du planning…</p>';
    try {
      var recettes = await App.chargerRecettes(ctx.sb);
      etat.recettes = recettes;
      etat.parId = {};
      recettes.forEach(function (r) { etat.parId[r.id] = r; });
      var ri = await ctx.sb.from('ingredients').select('id, nom');
      if (ri.error) throw ri.error;
      etat.ingParNom = {};
      (ri.data || []).forEach(function (i) { etat.ingParNom[i.nom] = i; });
      await chargerSemaine(ctx.sb);
    } catch (err) {
      c.innerHTML = '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>' +
        '<button type="button" class="bouton secondaire" id="plan-reessayer">Réessayer</button>';
      c.querySelector('#plan-reessayer').addEventListener('click', function () { recharger(c, ctx); });
      return;
    }
    if (c.isConnected) rendreSemaine(c, ctx);
  }

  App.onglets.push({
    id: 'planning',
    titre: 'Planning',
    icone: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    rendre: function (c, ctx) {
      if (!etat.lundi) etat.lundi = lundiCourant();
      etat.choix = null;
      etat.erreur = '';
      etat.ouvert = null;
      return recharger(c, ctx);   // toujours relu : l'autre personne a pu modifier le planning
    }
  });
})();
