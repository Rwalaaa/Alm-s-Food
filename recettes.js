// Onglet Recettes : liste filtrable + fiche détaillée
(function () {
  var h = App.h;
  var ETIQUETTES = ['Rapide', 'Végé', 'Léger', 'Copieux', 'Gamelle', 'Réconfortant', 'Petit budget', 'Soupe'];
  var etat = { recettes: null, filtres: [], pays: '', texte: '', ouverte: null };

  // Calcul des valeurs nutritives d'une portion (ingrédients facultatifs exclus)
  App.nutritionPortion = function (r) {
    var t = { kcal: 0, prot: 0, gluc: 0, lip: 0 };
    (r.recette_ingredients || []).forEach(function (ri) {
      var i = ri.ingredients;
      if (!i || ri.optionnel) return;
      var g = i.unite_base === 'piece' ? ri.quantite * (i.poids_piece_g || 0) : ri.quantite;
      t.kcal += g * (i.kcal_100g || 0) / 100;
      t.prot += g * (i.proteines_100g || 0) / 100;
      t.gluc += g * (i.glucides_100g || 0) / 100;
      t.lip += g * (i.lipides_100g || 0) / 100;
    });
    var p = r.portions || 1;
    return { kcal: Math.round(t.kcal / p), prot: Math.round(t.prot / p), gluc: Math.round(t.gluc / p), lip: Math.round(t.lip / p) };
  };

  // Recherche sans tenir compte des accents ni des majuscules
  function simplifier(s) {
    return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function dureeTexte(min) {
    if (min < 60) return min + ' min';
    var hh = Math.floor(min / 60), mm = min % 60;
    return hh + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  }

  async function charger(sb) {
    var r = await sb.from('recettes')
      .select('id, titre, description, categories, pays, vegetarien, temps_prep_min, temps_cuisson_min, portions, ' +
        'se_mange_froid, image_url, photo_perso_url, etapes, recette_ingredients(quantite, libelle_quantite, optionnel, ' +
        'ingredients(nom, rayon, unite_base, poids_piece_g, kcal_100g, proteines_100g, glucides_100g, lipides_100g))')
      .order('titre');
    if (r.error) throw r.error;
    r.data.forEach(function (rec) {
      rec._nutri = App.nutritionPortion(rec);
      rec._cherche = simplifier(rec.titre + ' ' + (rec.pays || '') + ' ' +
        (rec.recette_ingredients || []).map(function (ri) { return ri.ingredients ? ri.ingredients.nom : ''; }).join(' '));
    });
    etat.recettes = r.data;
  }

  function filtrer() {
    var t = simplifier(etat.texte.trim());
    return etat.recettes.filter(function (r) {
      if (t && r._cherche.indexOf(t) === -1) return false;
      if (etat.pays && r.pays !== etat.pays) return false;
      return etat.filtres.every(function (f) { return (r.categories || []).indexOf(f) !== -1; });
    });
  }

  // ---------- Liste ----------
  function rendreListe(c) {
    var pays = Array.from(new Set(etat.recettes.map(function (r) { return r.pays; }).filter(Boolean))).sort();
    c.innerHTML =
      '<div class="rec-outils">' +
        '<input type="search" class="rec-recherche" placeholder="Plat ou ingrédient" aria-label="Chercher une recette" value="' + h(etat.texte) + '">' +
        '<select class="rec-pays" aria-label="Pays">' +
          '<option value="">Tous les pays</option>' +
          pays.map(function (p) { return '<option' + (p === etat.pays ? ' selected' : '') + '>' + h(p) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="puces" role="group" aria-label="Filtres">' +
        ETIQUETTES.map(function (e) {
          return '<button type="button" class="puce" aria-pressed="' + (etat.filtres.indexOf(e) !== -1) + '">' + h(e) + '</button>';
        }).join('') +
      '</div>' +
      '<p class="rec-compte" aria-live="polite"></p>' +
      '<ul class="rec-liste"></ul>';

    var liste = c.querySelector('.rec-liste'), compte = c.querySelector('.rec-compte');
    function maj() {
      var res = filtrer();
      compte.textContent = res.length === 0 ? '' : res.length + (res.length > 1 ? ' recettes' : ' recette');
      liste.innerHTML = res.length === 0
        ? '<li class="rec-aucune">Aucune recette ne correspond. Retire un filtre ou change ta recherche.</li>'
        : res.map(function (r) {
          return '<li><button type="button" class="rec-item" data-id="' + h(r.id) + '">' +
            '<span class="rec-titre">' + h(r.titre) + '</span>' +
            '<span class="rec-infos"><span>' + dureeTexte(r.temps_prep_min + r.temps_cuisson_min) + '</span>' +
            '<span>' + r._nutri.kcal + ' kcal</span>' + (r.pays ? '<span>' + h(r.pays) + '</span>' : '') + '</span>' +
            '</button></li>';
        }).join('');
    }
    c.querySelector('.rec-recherche').addEventListener('input', function (e) { etat.texte = e.target.value; maj(); });
    c.querySelector('.rec-pays').addEventListener('change', function (e) { etat.pays = e.target.value; maj(); });
    c.querySelectorAll('.puce').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = b.textContent, i = etat.filtres.indexOf(e);
        if (i === -1) etat.filtres.push(e); else etat.filtres.splice(i, 1);
        b.setAttribute('aria-pressed', String(i === -1));
        maj();
      });
    });
    liste.addEventListener('click', function (e) {
      var b = e.target.closest('.rec-item');
      if (!b) return;
      etat.ouverte = b.dataset.id;
      try { history.pushState({ recette: etat.ouverte }, ''); } catch (err) { /* sans historique */ }
      rendreFiche(c);
    });
    maj();
  }

  // ---------- Fiche ----------
  function rendreFiche(c) {
    var r = etat.recettes.find(function (x) { return x.id === etat.ouverte; });
    if (!r) { etat.ouverte = null; return rendreListe(c); }
    var n = r._nutri;
    var ingr = (r.recette_ingredients || []).slice().sort(function (a, b) { return a.optionnel - b.optionnel; });
    c.innerHTML =
      '<button type="button" class="retour">Toutes les recettes</button>' +
      '<article class="fiche">' +
        '<h2 class="fiche-titre">' + h(r.titre) + '</h2>' +
        (r.description ? '<p class="fiche-desc">' + h(r.description) + '</p>' : '') +
        '<p class="fiche-etiquettes">' + (r.categories || []).map(function (e) { return '<span>' + h(e) + '</span>'; }).join('') + '</p>' +
        '<dl class="fiche-chiffres">' +
          '<div><dt>Préparation</dt><dd>' + dureeTexte(r.temps_prep_min) + '</dd></div>' +
          '<div><dt>Cuisson</dt><dd>' + dureeTexte(r.temps_cuisson_min) + '</dd></div>' +
          '<div><dt>Portions</dt><dd>' + r.portions + '</dd></div>' +
        '</dl>' +
        '<h3>Par portion</h3>' +
        '<dl class="fiche-nutri">' +
          '<div><dt>Énergie</dt><dd>' + n.kcal + ' kcal</dd></div>' +
          '<div><dt>Protéines</dt><dd>' + n.prot + ' g</dd></div>' +
          '<div><dt>Glucides</dt><dd>' + n.gluc + ' g</dd></div>' +
          '<div><dt>Lipides</dt><dd>' + n.lip + ' g</dd></div>' +
        '</dl>' +
        '<h3>Ingrédients</h3>' +
        '<ul class="fiche-ingr">' + ingr.map(function (ri) {
          return '<li><span class="q">' + h(ri.libelle_quantite || ri.quantite) + '</span> ' + h(ri.ingredients ? ri.ingredients.nom : '?') +
            (ri.optionnel ? ' <span class="discret">(facultatif)</span>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<h3>Préparation</h3>' +
        '<ol class="fiche-etapes">' + (r.etapes || []).map(function (e) {
          return '<li>' + h(e.texte) + (e.minuteur_s ? ' <span class="minuteur">' + dureeTexte(Math.round(e.minuteur_s / 60)) + '</span>' : '') + '</li>';
        }).join('') + '</ol>' +
      '</article>';
    c.querySelector('.retour').addEventListener('click', function () {
      if (history.state && history.state.recette) history.back(); else fermerFiche(c);
    });
    window.scrollTo(0, 0);
  }

  function fermerFiche(c) {
    etat.ouverte = null;
    rendreListe(c);
  }

  // Bouton retour du téléphone : ferme la fiche au lieu de quitter l'appli
  var conteneurActif = null;
  window.addEventListener('popstate', function () {
    if (etat.ouverte && conteneurActif && conteneurActif.isConnected) fermerFiche(conteneurActif);
  });

  var onglet = {
    id: 'recettes',
    titre: 'Recettes',
    icone: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>',
    rendre: async function (c, ctx) {
      conteneurActif = c;
      etat.ouverte = null;
      if (!etat.recettes) {
        c.innerHTML = '<p class="chargement">Chargement des recettes…</p>';
        try { await charger(ctx.sb); }
        catch (err) {
          c.innerHTML = '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>' +
            '<button type="button" class="bouton secondaire" id="rec-reessayer">Réessayer</button>';
          c.querySelector('#rec-reessayer').addEventListener('click', function () { onglet.rendre(c, ctx); });
          return;
        }
      }
      if (c.isConnected) rendreListe(c);
    }
  };
  App.onglets.push(onglet);
})();
