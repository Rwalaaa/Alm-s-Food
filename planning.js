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

  var etat = { lundi: null, repas: [], recettes: [], parId: {}, choix: null, texte: '', erreur: '', occupe: false };

  function lundiCourant() { return lundiDe(App.aujourdhui()); }
  function semainePassee() { return etat.lundi < lundiCourant(); }
  function lundiMin() { return plusJours(lundiCourant(), -7 * HISTORIQUE_SEMAINES); }

  async function chargerSemaine(sb) {
    var r = await sb.from('planning')
      .select('id, jour, moment, recette_id, portions, reste_de, froid')
      .gte('jour', iso(etat.lundi)).lte('jour', iso(plusJours(etat.lundi, 6)))
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
    });
  }

  function carte(p, lectureSeule) {
    var r = etat.parId[p.recette_id];
    return '<div class="plat" data-id="' + h(p.id) + '">' +
      '<span class="plat-titre">' + h(r ? r.titre : 'Recette supprimée') + '</span>' +
      (lectureSeule ? '<span class="plat-portions">' + p.portions + ' pers.</span>' :
      '<div class="plat-actions">' +
        '<button type="button" data-action="moins" aria-label="Une portion de moins"' + (p.portions <= 1 ? ' disabled' : '') + '>−</button>' +
        '<span class="plat-portions">' + p.portions + ' pers.</span>' +
        '<button type="button" data-action="plus" aria-label="Une portion de plus"' + (p.portions >= 20 ? ' disabled' : '') + '>+</button>' +
        '<button type="button" data-action="retirer" class="retirer" aria-label="Retirer ce plat">Retirer</button>' +
      '</div>') +
    '</div>';
  }

  async function action(c, ctx, id, quoi) {
    if (etat.occupe) return;
    var p = etat.repas.find(function (x) { return x.id === id; });
    if (!p) return;
    etat.occupe = true;
    var r;
    if (quoi === 'retirer') {
      r = await ctx.sb.from('planning').delete().eq('id', id);
      if (!r.error) etat.repas = etat.repas.filter(function (x) { return x.id !== id; });
    } else {
      var n = Math.min(20, Math.max(1, p.portions + (quoi === 'plus' ? 1 : -1)));
      r = await ctx.sb.from('planning').update({ portions: n }).eq('id', id);
      if (!r.error) p.portions = n;
    }
    etat.occupe = false;
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    if (c.isConnected) rendreSemaine(c, ctx);
  }

  // ---------- Choix d'une recette ----------
  function rendreChoix(c, ctx) {
    var ch = etat.choix;
    var d = new Date(ch.jour + 'T12:00:00');
    c.innerHTML =
      '<button type="button" class="retour">Annuler</button>' +
      '<h2 class="choix-titre">' + JOURS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ', ' + (ch.moment === 'midi' ? 'le midi' : 'le soir') + '</h2>' +
      '<input type="search" class="rec-recherche choix-recherche" placeholder="Plat ou ingrédient" aria-label="Chercher une recette">' +
      '<p class="erreur" role="alert" hidden></p>' +
      '<ul class="rec-liste choix-liste"></ul>';
    var liste = c.querySelector('.choix-liste');
    function maj() {
      var t = App.simplifier(etat.texte.trim());
      var res = etat.recettes.filter(function (r) { return !t || r._cherche.indexOf(t) !== -1; });
      liste.innerHTML = res.length ? res.map(function (r) {
        return '<li><button type="button" class="rec-item" data-id="' + h(r.id) + '"><span class="rec-titre">' + h(r.titre) + '</span>' +
          '<span class="rec-infos"><span>' + (r.temps_prep_min + r.temps_cuisson_min) + ' min</span><span>' + r._nutri.kcal + ' kcal</span></span></button></li>';
      }).join('') : '<li class="rec-aucune">Aucune recette ne correspond.</li>';
    }
    c.querySelector('.retour').addEventListener('click', function () { etat.choix = null; rendreSemaine(c, ctx); });
    c.querySelector('.choix-recherche').addEventListener('input', function (e) { etat.texte = e.target.value; maj(); });
    liste.addEventListener('click', async function (e) {
      var b = e.target.closest('.rec-item');
      if (!b || etat.occupe) return;
      etat.occupe = true;
      b.disabled = true;
      var r = await ctx.sb.from('planning')
        .insert({ jour: ch.jour, moment: ch.moment, recette_id: b.dataset.id, portions: Math.max(1, ctx.membres.length || 2) })
        .select('id, jour, moment, recette_id, portions, reste_de, froid').single();
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
    maj();
    window.scrollTo(0, 0);
  }

  // ---------- Chargement ----------
  async function recharger(c, ctx) {
    c.innerHTML = '<p class="chargement">Chargement du planning…</p>';
    try {
      var recettes = await App.chargerRecettes(ctx.sb);
      etat.recettes = recettes;
      etat.parId = {};
      recettes.forEach(function (r) { etat.parId[r.id] = r; });
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
      return recharger(c, ctx);   // toujours relu : l'autre personne a pu modifier le planning
    }
  });
})();
